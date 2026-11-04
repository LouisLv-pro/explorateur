use explorateur_core::{
    AppError,
    folders::{self, RecentFolder, RootFolder},
};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn open_root(state: State<'_, AppState>, path: String) -> Result<RootFolder, AppError> {
    folders::open_root(&state.db, &path).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_recent_folders(
    state: State<'_, AppState>,
) -> Result<Vec<RecentFolder>, AppError> {
    folders::list_recent_folders(&state.db).await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_recent_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    folders::remove_recent_folder(&state.db, &path).await
}

#[tauri::command]
#[specta::specta]
pub async fn last_root(state: State<'_, AppState>) -> Result<Option<RootFolder>, AppError> {
    folders::last_root(&state.db).await
}
