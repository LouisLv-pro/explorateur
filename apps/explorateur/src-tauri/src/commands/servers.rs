use explorateur_core::{
    AppError, Failure,
    servers::{self, ServerList},
};

use super::git::user_git;

/// Parcours du disque : sur un fil réservé aux tâches bloquantes (`spawn_blocking`).
#[tauri::command]
#[specta::specta]
pub async fn detect_servers(root: String) -> Result<ServerList, AppError> {
    tauri::async_runtime::spawn_blocking(move || servers::detect_servers_git(&user_git(), &root))
        .await
        .map_err(Failure::interrupted)
}

/// Connexion TCP bloquante (délai court) : sur un fil réservé aux tâches bloquantes.
#[tauri::command]
#[specta::specta]
pub async fn is_port_open(port: u16) -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(move || servers::is_port_open(port))
        .await
        .map_err(Failure::interrupted)
}
