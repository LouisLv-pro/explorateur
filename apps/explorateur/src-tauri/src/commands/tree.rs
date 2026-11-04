use explorateur_core::{
    AppError,
    tree::{self, Entry},
};

// `async` : une commande synchrone tourne sur le fil principal et figerait la fenêtre
// pendant la lecture d'un gros dossier ; asynchrone, elle tourne sur un fil de fond.
#[tauri::command]
#[specta::specta]
pub async fn list_directory(path: String, show_hidden: bool) -> Result<Vec<Entry>, AppError> {
    tree::list_directory(&path, show_hidden)
}
