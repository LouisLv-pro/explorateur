//! Notebooks Jupyter (spec notebook.md, décision 0024) : environnements Python et noyaux de
//! `core::notebook`. Les méthodes de `KernelSessions` bloquent (démarrage : jusqu'à 30 s), d'où
//! `spawn_blocking` partout.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use explorateur_core::{
    AppError, Failure,
    notebook::{self, EnvSearch, EventSink, KernelEvent, KernelId, KernelSessions, PythonEnv},
};
use tauri::{State, ipc::Channel};

use crate::state::AppState;

/// Noyaux ouverts et dossier racine (borne de la recherche des `.venv`).
#[derive(Default)]
pub struct Notebooks {
    /// `Arc` : passé aux tâches bloquantes, qui doivent posséder ce qu'elles utilisent.
    pub kernels: Arc<KernelSessions>,
    root: Mutex<Option<PathBuf>>,
}

impl Notebooks {
    fn root(&self) -> MutexGuard<'_, Option<PathBuf>> {
        self.root.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Nouveau dossier racine (`watch_root`) : les noyaux de l'ancien sont arrêtés. Le même
    /// dossier surveillé à nouveau (rechargement du front) les garde.
    pub fn set_root(&self, path: &str) {
        let path = PathBuf::from(path);
        let changed = self
            .root()
            .replace(path.clone())
            .is_some_and(|old| old != path);
        if changed {
            let kernels = Arc::clone(&self.kernels);
            // Arrêt doux, jusqu'à 2 s par noyau : hors du fil de la commande.
            std::thread::spawn(move || kernels.shutdown_all());
        }
    }
}

/// Environnements Python du notebook `path` : `.venv` de son dossier et de ses parents sous le
/// dossier racine, kernelspecs Jupyter, `python3` du shell (sondes de 5 s au plus).
#[tauri::command]
#[specta::specta]
pub async fn list_python_envs(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<PythonEnv>, AppError> {
    let notebook_path = PathBuf::from(path);
    let root = state
        .notebooks
        .root()
        .clone()
        .or_else(|| notebook_path.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        notebook::list_python_envs(&notebook_path, &root, &EnvSearch::system())
    })
    .await
    .map_err(Failure::interrupted)
}

/// Démarre un noyau pour le notebook `notebook_path` dans l'environnement `env_id`. Ses
/// événements arrivent par `channel` ; rend la main quand le noyau répond.
#[tauri::command]
#[specta::specta]
pub async fn start_kernel(
    state: State<'_, AppState>,
    notebook_path: String,
    env_id: String,
    channel: Channel<KernelEvent>,
) -> Result<KernelId, AppError> {
    let kernels = Arc::clone(&state.notebooks.kernels);
    let sink: EventSink = Arc::new(move |event| {
        // Le front a pu disparaître (rechargement) : l'événement est alors perdu.
        let _ = channel.send(event);
    });
    tauri::async_runtime::spawn_blocking(move || {
        // Environnement du shell de connexion : lu une fois, au premier noyau.
        let login_env = notebook::login_shell_env();
        kernels.start(Path::new(&notebook_path), &env_id, login_env, sink)
    })
    .await
    .map_err(Failure::interrupted)?
}

/// Envoie le code de la cellule `cell_id` au noyau. N'attend pas la fin de l'exécution.
#[tauri::command]
#[specta::specta]
pub async fn execute_cell(
    state: State<'_, AppState>,
    kernel_id: KernelId,
    cell_id: String,
    code: String,
) -> Result<(), AppError> {
    with_kernels(&state, move |k| k.execute(&kernel_id, &cell_id, &code)).await
}

/// Interrompt la cellule en cours.
#[tauri::command]
#[specta::specta]
pub async fn interrupt_kernel(
    state: State<'_, AppState>,
    kernel_id: KernelId,
) -> Result<(), AppError> {
    with_kernels(&state, move |k| k.interrupt(&kernel_id)).await
}

/// Redémarre le noyau (variables perdues), même identifiant et même canal.
#[tauri::command]
#[specta::specta]
pub async fn restart_kernel(
    state: State<'_, AppState>,
    kernel_id: KernelId,
) -> Result<(), AppError> {
    with_kernels(&state, move |k| k.restart(&kernel_id)).await
}

/// Arrête le noyau (onglet fermé, environnement changé).
#[tauri::command]
#[specta::specta]
pub async fn shutdown_kernel(
    state: State<'_, AppState>,
    kernel_id: KernelId,
) -> Result<(), AppError> {
    with_kernels(&state, move |k| k.shutdown(&kernel_id)).await
}

async fn with_kernels(
    state: &AppState,
    f: impl FnOnce(&KernelSessions) -> Result<(), AppError> + Send + 'static,
) -> Result<(), AppError> {
    let kernels = Arc::clone(&state.notebooks.kernels);
    tauri::async_runtime::spawn_blocking(move || f(&kernels))
        .await
        .map_err(Failure::interrupted)?
}
