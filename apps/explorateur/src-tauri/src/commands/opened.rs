//! Fichiers et dossiers ouverts depuis le Finder, un lien `explorateur://` ou la commande
//! `explorateur` (specs `ouvrir-depuis-finder.md` et `ouvrir-depuis-terminal.md`).
//!
//! macOS livre les URL à l'app par `RunEvent::Opened` (double-clic, « Ouvrir avec », dépôt
//! sur l'icône du Dock, `open "explorateur://open?…"`). Les demandes s'accumulent dans une
//! file ; le front la vide par `take_opened_paths`, au lancement puis à chaque `PathsOpened`.

use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use explorateur_core::{
    AppError, Failure,
    folders::{self, OpenRequest, OpenTarget},
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use super::git::user_git;

/// File des demandes reçues (Finder, lien, CLI) et pas encore lues par le front.
///
/// État à part (géré par le `Builder`, pas dans `setup`) : au lancement par le Finder, macOS peut
/// livrer `Opened` avant `setup`, quand `AppState` n'existe pas encore.
#[derive(Default)]
pub struct OpenedPaths {
    queue: Mutex<Vec<OpenRequest>>,
    /// Vrai une fois `mount_events` appelé (dans `setup`) : avant, émettre un événement
    /// tauri-specta fait paniquer. Avant `setup`, le front n'est pas chargé : il lira la file.
    events_ready: AtomicBool,
}

impl OpenedPaths {
    /// À appeler dans `setup`, après `mount_events`.
    pub fn mark_ready(&self) {
        self.events_ready.store(true, Ordering::SeqCst);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<OpenRequest>> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Des demandes sont arrivées (Finder, lien, CLI) : le front doit appeler `take_opened_paths`.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct PathsOpened;

/// Demande tirée d'une URL reçue : `file://` (Finder) ou `explorateur://open?…` (lien, CLI).
/// Un lien refusé par `parse_open_link` est journalisé ; les autres schémas sont ignorés.
#[cfg(target_os = "macos")]
fn request_of(url: &tauri::Url) -> Option<OpenRequest> {
    match url.scheme() {
        "file" => url.to_file_path().ok().map(|path| OpenRequest {
            path: path.to_string_lossy().into_owned(),
            line: None,
            column: None,
            link: false,
        }),
        "explorateur" => {
            let request = folders::parse_open_link(url.as_str());
            if request.is_none() {
                tracing::warn!("lien explorateur refusé : {url}");
            }
            request
        }
        _ => None,
    }
}

/// Traite `RunEvent::Opened` : garde les URL `file://` et `explorateur://`, prévient le front,
/// et ramène la fenêtre au premier plan si elle est déjà affichée.
#[cfg(target_os = "macos")]
pub fn on_opened(app: &AppHandle, urls: &[tauri::Url]) {
    let requests: Vec<OpenRequest> = urls.iter().filter_map(request_of).collect();
    if requests.is_empty() {
        return;
    }
    let Some(opened) = app.try_state::<OpenedPaths>() else {
        return;
    };
    opened.lock().extend(requests);

    if opened.events_ready.load(Ordering::SeqCst)
        && let Err(err) = PathsOpened.emit(app)
    {
        tracing::warn!("événement PathsOpened : {err}");
    }

    // Fenêtre réduite dans le Dock ou déjà affichée : au premier plan. Fenêtre encore masquée
    // (lancement) : le front l'affiche après le thème (mode-sombre.md).
    if let Some(window) = app.get_webview_window("main")
        && (window.is_minimized().unwrap_or(false) || window.is_visible().unwrap_or(false))
    {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Vide la file et donne la cible d'ouverture (dossier racine et fichiers à ouvrir), ou `None`.
/// `current_root` : dossier racine affiché (`null` au lancement).
#[tauri::command]
#[specta::specta]
pub async fn take_opened_paths(
    opened: State<'_, OpenedPaths>,
    current_root: Option<String>,
) -> Result<Option<OpenTarget>, AppError> {
    let requests = std::mem::take(&mut *opened.lock());
    if requests.is_empty() {
        return Ok(None);
    }
    // `resolve_requests` lance git : sur un fil réservé aux tâches bloquantes.
    tauri::async_runtime::spawn_blocking(move || {
        folders::resolve_requests(&user_git(), current_root.as_deref(), &requests)
    })
    .await
    .map_err(Failure::interrupted)
}

#[cfg(all(test, target_os = "macos"))]
#[allow(clippy::unwrap_used, reason = "tests")]
mod tests {
    use super::*;

    fn request(url: &str) -> Option<OpenRequest> {
        request_of(&tauri::Url::parse(url).unwrap())
    }

    // macOS livre un `tauri::Url` : son `as_str()` doit garder l'encodage et le `+` du lien.
    #[test]
    fn lien_passe_par_url_garde_chemin_ligne_et_plus() {
        let got = request("explorateur://open?path=/a%20b/c+d%C3%A9.rs&line=12&column=3").unwrap();
        assert_eq!(got.path, "/a b/c+dé.rs");
        assert_eq!((got.line, got.column, got.link), (Some(12), Some(3), true));
    }

    #[test]
    fn url_file_donne_une_demande_du_finder() {
        let got = request("file:///a%20b/c.md").unwrap();
        assert_eq!(got.path, "/a b/c.md");
        assert!(!got.link);
    }

    #[test]
    fn autre_hote_ou_schema_est_ignore() {
        assert!(request("explorateur://run?path=/x").is_none());
        assert!(request("https://example.com/?path=/x").is_none());
    }
}
