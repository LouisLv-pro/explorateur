use explorateur_core::{AppError, files};
use tauri_plugin_opener::OpenerExt;

/// Traduit une erreur de l'opener en `AppError::Io` (l'existence est déjà vérifiée).
fn opener_error(path: &str, err: &tauri_plugin_opener::Error) -> AppError {
    AppError::Io(format!("{path}: {err}"))
}

/// Sélectionne `path` dans le Finder.
#[tauri::command]
#[specta::specta]
pub async fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    files::ensure_exists(&path)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|err| opener_error(&path, &err))
}

/// Crée un fichier vide `dir/name` ; renvoie son chemin absolu.
#[tauri::command]
#[specta::specta]
pub async fn create_file(dir: String, name: String) -> Result<String, AppError> {
    files::create_file(&dir, &name)
}

/// Crée un dossier vide `dir/name` ; renvoie son chemin absolu.
#[tauri::command]
#[specta::specta]
pub async fn create_dir(dir: String, name: String) -> Result<String, AppError> {
    files::create_dir(&dir, &name)
}

/// Renomme `path` dans son dossier ; renvoie le nouveau chemin absolu.
#[tauri::command]
#[specta::specta]
pub async fn rename_entry(path: String, new_name: String) -> Result<String, AppError> {
    files::rename_entry(&path, &new_name)
}

/// Enregistre `text` dans `path` si sa révision est toujours `revision` ; renvoie la nouvelle.
#[tauri::command]
#[specta::specta]
pub async fn save_file(path: String, text: String, revision: String) -> Result<String, AppError> {
    files::save_file(&path, &text, &revision)
}

/// Met `path` à la corbeille (jamais de suppression définitive).
#[tauri::command]
#[specta::specta]
pub async fn move_to_trash(path: String) -> Result<(), AppError> {
    files::move_to_trash(&path)
}

/// Ouvre `path` avec l'application par défaut de macOS.
#[tauri::command]
#[specta::specta]
pub async fn open_with_default_app(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    files::ensure_exists(&path)?;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|err| opener_error(&path, &err))
}
