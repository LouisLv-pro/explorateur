//! Modifié depuis votre dernière lecture (spec derniere-lecture.md) : délègue au `ReadTracker`
//! de l'état partagé.

use std::sync::{Mutex, MutexGuard, PoisonError};

use explorateur_core::{
    AppError,
    last_read::{ReadMarks, ReadOutcome, ReadTracker},
};
use tauri::State;

use crate::state::AppState;

/// Note la lecture de `path` (onglet actif, fenêtre active) et rend ce qui a changé depuis la
/// précédente. `async` : la lecture du fichier et le diff tournent sur un fil de fond.
#[tauri::command]
#[specta::specta]
pub async fn mark_read(state: State<'_, AppState>, path: String) -> Result<ReadOutcome, AppError> {
    lock(&state.reads).mark_read(&path)
}

/// Pastilles sous le dossier racine `root`.
#[tauri::command]
#[specta::specta]
pub fn get_read_marks(state: State<'_, AppState>, root: String) -> ReadMarks {
    lock(&state.reads).marks(&root)
}

/// Verrou du suivi ; un verrou empoisonné (panic d'un autre fil) est repris tel quel.
pub fn lock(reads: &Mutex<ReadTracker>) -> MutexGuard<'_, ReadTracker> {
    reads.lock().unwrap_or_else(PoisonError::into_inner)
}
