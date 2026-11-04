use std::path::Path;

use explorateur_core::{
    AppError, Failure, files,
    git::{
        self, CommitOptions, DiffLine, FileChange, Git, GitSnapshot, GutterBlock, Hunk, RemoteState,
    },
};

/// Emplacements où chercher git, dans l'ordre : une app lancée depuis le Finder a un `PATH`
/// réduit (`/usr/bin:/bin:…`), qui ne voit pas le git de Homebrew.
const GIT_CANDIDATES: [&str; 3] = [
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
];

/// Premier git existant parmi les emplacements connus, sinon `git` cherché dans le `PATH`.
pub(super) fn user_git() -> Git {
    GIT_CANDIDATES
        .iter()
        .find(|path| Path::new(path).is_file())
        .map_or_else(|| Git::new("git"), |path| Git::new(*path))
}

/// Chaque appel lance un ou plusieurs processus git : sur un fil réservé aux tâches bloquantes.
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(Failure::interrupted)?
}

/// Statut du dépôt qui contient le dossier racine et repères de l'arborescence, lus par un
/// seul `git status`.
#[tauri::command]
#[specta::specta]
pub async fn get_git_status(root: String) -> Result<GitSnapshot, AppError> {
    blocking(move || git::get_snapshot(&user_git(), &root)).await
}

/// Diff d'une modification de la liste.
#[tauri::command]
#[specta::specta]
pub async fn get_git_diff(root: String, change: FileChange) -> Result<git::Diff, AppError> {
    blocking(move || git::get_diff(&user_git(), &root, &change)).await
}

/// Lignes masquées avant le bloc `gap` (ou après le dernier).
#[tauri::command]
#[specta::specta]
pub async fn get_git_hidden_lines(
    root: String,
    change: FileChange,
    gap: u32,
) -> Result<Vec<DiffLine>, AppError> {
    blocking(move || git::get_hidden_lines(&user_git(), &root, &change, gap)).await
}

/// « Indexer » un fichier.
#[tauri::command]
#[specta::specta]
pub async fn git_stage_file(root: String, change: FileChange) -> Result<(), AppError> {
    blocking(move || git::stage_file(&user_git(), &root, &change)).await
}

/// « Désindexer » un fichier.
#[tauri::command]
#[specta::specta]
pub async fn git_unstage_file(root: String, change: FileChange) -> Result<(), AppError> {
    blocking(move || git::unstage_file(&user_git(), &root, &change)).await
}

/// « Tout indexer ».
#[tauri::command]
#[specta::specta]
pub async fn git_stage_all(root: String) -> Result<(), AppError> {
    blocking(move || git::stage_all(&user_git(), &root)).await
}

/// « Tout désindexer ».
#[tauri::command]
#[specta::specta]
pub async fn git_unstage_all(root: String) -> Result<(), AppError> {
    blocking(move || git::unstage_all(&user_git(), &root)).await
}

/// Indexe un bloc du diff non indexé.
#[tauri::command]
#[specta::specta]
pub async fn git_stage_hunk(root: String, change: FileChange, hunk: Hunk) -> Result<(), AppError> {
    blocking(move || git::stage_hunk(&user_git(), &root, &change, &hunk)).await
}

/// Désindexe un bloc du diff indexé.
#[tauri::command]
#[specta::specta]
pub async fn git_unstage_hunk(
    root: String,
    change: FileChange,
    hunk: Hunk,
) -> Result<(), AppError> {
    blocking(move || git::unstage_hunk(&user_git(), &root, &change, &hunk)).await
}

/// « Annuler les modifications » d'un fichier (non suivi : corbeille de macOS).
#[tauri::command]
#[specta::specta]
pub async fn git_discard_file(root: String, change: FileChange) -> Result<(), AppError> {
    blocking(move || git::discard_file(&user_git(), &root, &change, &files::move_to_trash)).await
}

/// « Annuler les modifications » d'un bloc.
#[tauri::command]
#[specta::specta]
pub async fn git_discard_hunk(
    root: String,
    change: FileChange,
    hunk: Hunk,
) -> Result<(), AppError> {
    blocking(move || git::discard_hunk(&user_git(), &root, &change, &hunk)).await
}

/// Committe l'index ; rend le hash court du commit créé.
#[tauri::command]
#[specta::specta]
pub async fn git_commit(
    root: String,
    message: String,
    options: CommitOptions,
) -> Result<String, AppError> {
    blocking(move || git::commit(&user_git(), &root, &message, options)).await
}

/// Texte indexé d'un fichier (relatif au dossier racine), base de la gouttière.
#[tauri::command]
#[specta::specta]
pub async fn get_git_index_text(root: String, path: String) -> Result<Option<String>, AppError> {
    blocking(move || git::get_index_text(&user_git(), &root, &path)).await
}

/// Chemin dans le dépôt, hash de HEAD et état d'un fichier (relatif au dossier racine) : lien
/// GitHub de ses lignes.
#[tauri::command]
#[specta::specta]
pub async fn get_git_file_link_info(
    root: String,
    path: String,
) -> Result<Option<git::FileLinkInfo>, AppError> {
    blocking(move || git::file_link_info(&user_git(), &root, &path)).await
}

/// Blocs de la gouttière entre le texte indexé et le texte de l'éditeur. Calcul pur, mais
/// borné à 200 ms sur un gros fichier : hors du fil des commandes, comme les autres.
#[tauri::command]
#[specta::specta]
pub async fn get_git_gutter_blocks(
    index_text: String,
    editor_text: String,
) -> Result<Vec<GutterBlock>, AppError> {
    blocking(move || Ok(git::gutter_blocks(&index_text, &editor_text))).await
}

/// Message du dernier commit (`None` sans commit), pour « Modifier le dernier commit ».
#[tauri::command]
#[specta::specta]
pub async fn git_last_commit_message(root: String) -> Result<Option<String>, AppError> {
    blocking(move || git::last_commit_message(&user_git(), &root)).await
}

/// État de la branche distante (amont, `↑A ↓B`), lu sans réseau.
#[tauri::command]
#[specta::specta]
pub async fn get_git_remote_state(root: String) -> Result<RemoteState, AppError> {
    blocking(move || git::get_remote_state(&user_git(), &root)).await
}

/// Récupère le distant (`git fetch --prune`), 60 s au plus.
#[tauri::command]
#[specta::specta]
pub async fn git_fetch(root: String) -> Result<(), AppError> {
    blocking(move || git::git_fetch(&user_git(), &root)).await
}

/// Pousse la branche courante, ou la publie si elle n'a pas d'amont.
#[tauri::command]
#[specta::specta]
pub async fn git_push(root: String) -> Result<(), AppError> {
    blocking(move || git::git_push(&user_git(), &root)).await
}

/// Tire l'amont en fast-forward ; rend le nombre de commits tirés.
#[tauri::command]
#[specta::specta]
pub async fn git_pull(root: String) -> Result<u32, AppError> {
    blocking(move || git::git_pull(&user_git(), &root)).await
}
