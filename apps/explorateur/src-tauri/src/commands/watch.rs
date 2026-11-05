use explorateur_core::{
    AppError,
    watch::{DiskChange, RootWatcher},
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::{commands::last_read, state::AppState};

/// Lot de changements du disque sous le dossier racine, poussé vers le front.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct DiskChanged(pub DiskChange);

/// Surveille `path` (remplace la surveillance précédente).
#[tauri::command]
#[specta::specta]
pub fn watch_root(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    // L'ancienne surveillance est arrêtée avant d'en démarrer une nouvelle.
    stop(&state);
    // Nouveau dossier racine : pastilles « jamais lu » effacées (spec derniere-lecture.md).
    last_read::lock(&state.reads).set_root(&path);
    // Et noyaux des notebooks de l'ancien dossier arrêtés (spec notebook.md).
    state.notebooks.set_root(&path);
    let watcher = RootWatcher::start(&path, move |change| {
        // Pastilles à jour avant que le front ne les relise sur `DiskChanged`.
        last_read::lock(&app.state::<AppState>().reads).note_changes(&change.files);
        if let Err(err) = DiskChanged(change).emit(&app) {
            tracing::warn!("événement DiskChanged : {err}");
        }
    })?;
    *lock(&state) = Some(watcher);
    Ok(())
}

/// Arrête la surveillance du dossier racine.
#[tauri::command]
#[specta::specta]
pub fn unwatch_root(state: State<'_, AppState>) {
    stop(&state);
}

fn stop(state: &AppState) {
    lock(state).take();
}

/// Verrou de l'état ; un verrou empoisonné (panic d'un autre fil) est repris tel quel.
fn lock(state: &AppState) -> std::sync::MutexGuard<'_, Option<RootWatcher>> {
    state
        .watcher
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
