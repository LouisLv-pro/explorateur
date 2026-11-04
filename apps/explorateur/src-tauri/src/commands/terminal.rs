//! Terminal intégré (spec terminal.md, décision 0006) : une session de `core::terminal` par
//! page, rangée dans `AppState.terminals` sous l'identifiant choisi par le front.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use explorateur_core::{
    AppError, Failure,
    terminal::{self, FileLink, SessionOptions, ShellCommand, TerminalSession, TerminalSize},
};
use serde::Serialize;
use tauri::{
    AppHandle, State,
    ipc::{Channel, InvokeResponseBody, IpcResponse},
};
use tauri_specta::Event;

use crate::state::AppState;

/// Sessions vivantes, par identifiant de page.
#[derive(Default)]
pub struct TerminalSessions(Mutex<HashMap<u32, TerminalSession>>);

impl TerminalSessions {
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, TerminalSession>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Commandes en cours, pages dans l'ordre de leur identifiant (ordre de création).
    pub fn running_commands(&self) -> Vec<String> {
        let sessions = self.lock();
        let mut ids: Vec<&u32> = sessions.keys().collect();
        ids.sort_unstable();
        terminal::running_commands(ids.into_iter().filter_map(|id| sessions.get(id)))
    }

    /// Ferme toutes les sessions et attend la fin de leurs processus (sortie de l'app).
    pub fn close_all(&self) {
        let sessions: Vec<TerminalSession> = self.lock().drain().map(|(_, s)| s).collect();
        terminal::close_all(sessions);
    }
}

/// Morceau de sortie du shell, envoyé en octets bruts : le front reçoit un `ArrayBuffer`, pas
/// un tableau JSON de nombres (que donnerait un `Channel<Vec<u8>>`). `InvokeResponseBody` n'a
/// pas de type specta : ce type local le porte (le TypeScript généré dit `number[]`, `api.ts`
/// du terminal le reprend en `ArrayBuffer`).
#[derive(specta::Type)]
pub struct TerminalOutput(Vec<u8>);

impl IpcResponse for TerminalOutput {
    fn body(self) -> tauri::Result<InvokeResponseBody> {
        Ok(InvokeResponseBody::Raw(self.0))
    }
}

/// Le shell d'une page s'est terminé de lui-même (`exit`, `⌃D`).
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct TerminalExited {
    pub id: u32,
    pub code: u32,
}

/// Lance le shell de connexion dans `cwd` pour la page `id`. La sortie arrive en octets bruts
/// (`ArrayBuffer` côté front) par `on_output`. Une session existante du même `id` est fermée.
#[tauri::command]
#[specta::specta]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalOutput>,
) -> Result<(), AppError> {
    let options = SessionOptions {
        cwd,
        size: TerminalSize { cols, rows },
        shell: ShellCommand::login(),
    };
    let session = TerminalSession::start(
        options,
        move |bytes| {
            // Le front a pu disparaître (rechargement) : la sortie est alors perdue.
            let _ = on_output.send(TerminalOutput(bytes.to_vec()));
        },
        move |code| {
            if let Some(state) = tauri::Manager::try_state::<AppState>(&app) {
                state.terminals.lock().remove(&id);
            }
            if let Err(err) = (TerminalExited { id, code }).emit(&app) {
                tracing::warn!("événement TerminalExited : {err}");
            }
        },
    )?;
    let previous = state.terminals.lock().insert(id, session);
    drop(previous);
    Ok(())
}

/// Écrit la saisie `data` (texte UTF-8 venu de xterm) sur l'entrée du shell de la page `id`.
#[tauri::command]
#[specta::specta]
pub fn write_terminal(state: State<'_, AppState>, id: u32, data: String) -> Result<(), AppError> {
    with_session(&state, id, |s| s.write(data.as_bytes()))
}

/// Change la taille du terminal de la page `id`.
#[tauri::command]
#[specta::specta]
pub fn resize_terminal(
    state: State<'_, AppState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    with_session(&state, id, |s| s.resize(TerminalSize { cols, rows }))
}

/// Ferme la page `id` : termine son groupe de processus (raccroché, puis arrêt forcé après 2 s).
#[tauri::command]
#[specta::specta]
pub fn close_terminal(state: State<'_, AppState>, id: u32) {
    let session = state.terminals.lock().remove(&id);
    if let Some(session) = session {
        session.close();
    }
}

/// Page dont un processus tourne au premier plan (icône de chargement sur son onglet).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RunningTerminal {
    pub id: u32,
    /// Nom court de la commande (ex. `sleep`).
    pub command: String,
}

/// Pages ayant un processus en cours. Sondée par le front (environ toutes les secondes).
#[tauri::command]
#[specta::specta]
pub fn running_terminals(state: State<'_, AppState>) -> Vec<RunningTerminal> {
    let sessions = state.terminals.lock();
    let mut running: Vec<RunningTerminal> = sessions
        .iter()
        .filter_map(|(&id, s)| {
            s.running_command()
                .map(|command| RunningTerminal { id, command })
        })
        .collect();
    running.sort_unstable_by_key(|r| r.id);
    running
}

/// Commandes en cours de toutes les pages, sans doublon (confirmation de sortie de l'app).
#[tauri::command]
#[specta::specta]
pub fn running_commands(state: State<'_, AppState>) -> Vec<String> {
    state.terminals.running_commands()
}

/// Liens fichier de la ligne `line` d'une page lancée dans `cwd`, limités au dossier racine
/// `root` (accès disque : sur un fil réservé aux tâches bloquantes).
#[tauri::command]
#[specta::specta]
pub async fn find_terminal_links(
    line: String,
    cwd: String,
    root: String,
) -> Result<Vec<FileLink>, AppError> {
    tauri::async_runtime::spawn_blocking(move || terminal::find_file_links(&line, &cwd, &root))
        .await
        .map_err(Failure::interrupted)
}

/// Chemin échappé pour le shell (glisser une entrée de l'arborescence sur le terminal).
#[tauri::command]
#[specta::specta]
pub fn shell_quote(path: String) -> String {
    terminal::shell_quote(&path)
}

fn with_session(
    state: &AppState,
    id: u32,
    f: impl FnOnce(&TerminalSession) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let sessions = state.terminals.lock();
    let session = sessions
        .get(&id)
        .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
    f(session)
}
