use explorateur_core::{
    AppError, Failure,
    search::{self, ContentSearch, FileMatch},
};

use super::git::user_git;

/// Parcours du disque : sur un fil réservé aux tâches bloquantes (`spawn_blocking`), pour ne pas
/// occuper un fil du runtime asynchrone.
#[tauri::command]
#[specta::specta]
pub async fn find_files(
    root: String,
    query: String,
    show_hidden: bool,
) -> Result<Vec<FileMatch>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        search::find_files_git(&user_git(), &root, &query, show_hidden)
    })
    .await
    .map_err(Failure::interrupted)?
}

/// Lecture de nombreux fichiers : sur un fil réservé aux tâches bloquantes (`spawn_blocking`).
#[tauri::command]
#[specta::specta]
pub async fn search_content(
    root: String,
    query: String,
    case_sensitive: bool,
    show_hidden: bool,
) -> Result<ContentSearch, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        search::search_content_git(&user_git(), &root, &query, case_sensitive, show_hidden)
    })
    .await
    .map_err(Failure::interrupted)?
}
