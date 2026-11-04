mod commands;
mod menu;
mod protocol;
mod state;

use std::{
    error::Error,
    fs::File,
    path::Path,
    sync::{Arc, Mutex, atomic::AtomicBool},
    time::Duration,
};

use explorateur_core::{apps::FlutterDeviceCache, last_read::ReadTracker};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_specta::{Builder, collect_commands, collect_events};

use crate::{
    commands::{browser::BrowserTabs, opened::OpenedPaths, terminal::TerminalSessions},
    state::AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn Error>> {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::folders::open_root,
            commands::folders::list_recent_folders,
            commands::folders::remove_recent_folder,
            commands::folders::last_root,
            commands::opened::take_opened_paths,
            commands::tree::list_directory,
            commands::preview::open_file,
            commands::search::find_files,
            commands::search::search_content,
            commands::files::reveal_in_finder,
            commands::files::open_with_default_app,
            commands::files::create_file,
            commands::files::create_dir,
            commands::files::rename_entry,
            commands::files::move_to_trash,
            commands::files::save_file,
            commands::app::set_unsaved_changes,
            commands::app::quit_app,
            commands::app::set_language,
            commands::watch::watch_root,
            commands::watch::unwatch_root,
            commands::last_read::mark_read,
            commands::last_read::get_read_marks,
            commands::terminal::start_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::running_terminals,
            commands::terminal::running_commands,
            commands::terminal::find_terminal_links,
            commands::terminal::shell_quote,
            commands::git::get_git_status,
            commands::git::get_git_diff,
            commands::git::get_git_hidden_lines,
            commands::git::git_stage_file,
            commands::git::git_unstage_file,
            commands::git::git_stage_all,
            commands::git::git_unstage_all,
            commands::git::git_stage_hunk,
            commands::git::git_unstage_hunk,
            commands::git::git_discard_file,
            commands::git::git_discard_hunk,
            commands::git::git_commit,
            commands::git::git_last_commit_message,
            commands::git::get_git_index_text,
            commands::git::get_git_file_link_info,
            commands::git::get_git_gutter_blocks,
            commands::git::get_git_remote_state,
            commands::git::git_fetch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::github::get_github_repo,
            commands::github::list_github_issues,
            commands::github::get_github_issue,
            commands::github::create_github_issue,
            commands::github::list_github_labels,
            commands::github::list_github_assignees,
            commands::github::get_github_user,
            commands::github::list_issue_templates,
            commands::servers::detect_servers,
            commands::servers::is_port_open,
            commands::apps::detect_apps,
            commands::apps::list_simulators,
            commands::apps::list_android_devices,
            commands::apps::get_app_command,
            commands::apps::list_flutter_devices,
            commands::apps::get_flutter_command,
            commands::browser::browser_navigate,
            commands::browser::browser_layout,
            commands::browser::browser_close,
            commands::browser::browser_back,
            commands::browser::browser_forward,
            commands::browser::browser_reload,
        ])
        .events(collect_events![
            commands::watch::DiskChanged,
            commands::terminal::TerminalExited,
            commands::browser::BrowserNavigated,
            commands::browser::BrowserTitleChanged,
            commands::browser::BrowserLoading,
            commands::browser::BrowserNewTab,
            commands::opened::PathsOpened
        ]);

    // En dev, régénère les types TypeScript des commandes dans src/bindings.ts.
    // Chemin absolu : un chemin relatif dépendrait du dossier d'où l'app est lancée.
    #[cfg(debug_assertions)]
    builder.export(
        specta_typescript::Typescript::default(),
        concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts"),
    )?;

    tauri::Builder::default()
        // File des chemins du Finder : gérée ici, pas dans `setup`, car macOS peut livrer
        // `RunEvent::Opened` avant `setup` au lancement par le Finder.
        .manage(OpenedPaths::default())
        // Lecture gardée de `flutter devices` ; `Arc` pour passer au fil des tâches bloquantes.
        .manage(Arc::new(FlutterDeviceCache::default()))
        // Sélecteur natif de dossier (seule permission : dialog:allow-open).
        .plugin(tauri_plugin_dialog::init())
        // Liens externes du Markdown (permission : opener:allow-open-url seule).
        .plugin(tauri_plugin_opener::init())
        // Pages HTML prévisualisées et leurs ressources, lues sur un fil de fond.
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::respond(&request));
            });
        })
        // Anglais au lancement ; le front envoie sa langue par `set_language`.
        .menu(|app| menu::build(app, menu::Lang::En))
        .on_menu_event(menu::on_event)
        // Fermer la fenêtre (bouton rouge) avec des modifications non enregistrées ou un
        // processus en cours dans un terminal : le front confirme, puis quitte par `quit_app`.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && menu::must_confirm_quit(window.app_handle())
            {
                api.prevent_close();
                menu::emit(window.app_handle(), menu::QUIT_REQUESTED);
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            app.state::<OpenedPaths>().mark_ready();
            init_logs(&app.path().app_log_dir()?)?;

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = tauri::async_runtime::block_on(explorateur_core::db::open(
                &data_dir.join(DB_FILE),
            ))?;
            app.manage(AppState {
                db,
                watcher: Mutex::new(None),
                unsaved: AtomicBool::new(false),
                terminals: TerminalSessions::default(),
                browser: BrowserTabs::default(),
                reads: Mutex::new(ReadTracker::new()),
            });
            show_window_fallback(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|app, event| {
            // Quitter (⌘Q, fenêtre fermée, `quit_app`) termine les shells et leurs processus :
            // sinon `pnpm dev` survivrait en orphelin (spec terminal.md).
            if let RunEvent::Exit = event
                && let Some(state) = app.try_state::<AppState>()
            {
                state.terminals.close_all();
            }
            // Fichier ou dossier ouvert depuis le Finder (spec ouvrir-depuis-finder.md).
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                commands::opened::on_opened(app, urls);
            }
        });
    Ok(())
}

/// Délai après lequel Rust affiche la fenêtre si le front ne l'a pas fait.
const SHOW_TIMEOUT: Duration = Duration::from_secs(2);

/// La fenêtre est créée masquée (`visible: false`) : le front l'affiche une fois le thème posé,
/// pour éviter un flash clair en sombre (spec mode-sombre.md). Filet de sécurité si le front
/// plante avant : sans lui, l'app tournerait sans fenêtre. Afficher une fenêtre déjà visible
/// ne fait rien.
fn show_window_fallback(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_TIMEOUT);
        if let Some(window) = app.get_webview_window("main")
            && let Err(err) = window.show()
        {
            tracing::warn!("fenêtre non affichée : {err}");
        }
    });
}

/// Base séparée en debug : `tauri dev` applique ses migrations à `app-dev.db`, jamais à la base
/// de l'app installée (une app plus ancienne refuse de s'ouvrir sur une base déjà migrée).
const DB_FILE: &str = if cfg!(debug_assertions) {
    "app-dev.db"
} else {
    "app.db"
};

/// Écrit les logs `tracing` dans `<app_log_dir>/app.log` (niveau via `RUST_LOG`, `info` par défaut).
fn init_logs(dir: &Path) -> Result<(), Box<dyn Error>> {
    std::fs::create_dir_all(dir)?;
    let file = File::create(dir.join("app.log"))?;
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(Mutex::new(file))
        .with_ansi(false)
        .init();
    Ok(())
}
