use explorateur_core::{
    AppError,
    preview::{self, FilePreview},
};

// `async` : comme `list_directory`, la lecture tourne sur un fil de fond.
#[tauri::command]
#[specta::specta]
pub async fn open_file(path: String) -> Result<FilePreview, AppError> {
    preview::open_file(&path)
}
