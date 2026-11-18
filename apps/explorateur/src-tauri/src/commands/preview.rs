use std::path::PathBuf;

use explorateur_core::{
    AppError, Failure,
    presentation::{self, PresentationRender},
    preview::{self, FilePreview},
};
use tauri::{AppHandle, Manager};

// `async` : comme `list_directory`, la lecture tourne sur un fil de fond.
#[tauri::command]
#[specta::specta]
pub async fn open_file(path: String) -> Result<FilePreview, AppError> {
    preview::open_file(&path)
}

/// Rend une présentation `.pptx` en HTML dans le cache de l'app (spec `apercu-pptx.md`).
/// Quick Look lance un processus externe : le rendu tourne sur un fil de fond.
#[tauri::command]
#[specta::specta]
pub async fn render_presentation(
    app: AppHandle,
    path: String,
) -> Result<PresentationRender, AppError> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| Failure::CacheDirNotFound(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        presentation::render_presentation(&PathBuf::from(path), &cache_dir)
    })
    .await
    .map_err(Failure::interrupted)?
}
