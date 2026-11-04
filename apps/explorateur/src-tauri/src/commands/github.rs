use std::path::Path;

use explorateur_core::{
    AppError, Failure,
    github::{
        self, Gh, Issue, IssueFilter, IssueSummary, IssueTemplate, Label, NewIssue, RepoInfo,
    },
};

use super::git::user_git;

/// Emplacements où chercher `gh`, dans l'ordre : une app lancée depuis le Finder a un `PATH`
/// réduit, qui ne voit pas le `gh` de Homebrew.
const GH_CANDIDATES: [&str; 2] = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

/// Premier `gh` existant parmi les emplacements connus, sinon `gh` cherché dans le `PATH`.
fn user_gh() -> Gh {
    GH_CANDIDATES
        .iter()
        .find(|path| Path::new(path).is_file())
        .map_or_else(|| Gh::new("gh"), |path| Gh::new(*path))
}

/// Chaque appel lance un processus `gh` (réseau compris) : sur un fil réservé aux tâches bloquantes.
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(Failure::interrupted)?
}

/// Dépôt GitHub du dossier racine. `gh` retrouve lui-même la racine du dépôt git depuis `root`.
#[tauri::command]
#[specta::specta]
pub async fn get_github_repo(root: String) -> Result<RepoInfo, AppError> {
    blocking(move || github::repo_view(&user_gh(), Path::new(&root))).await
}

/// Les 100 issues les plus récemment mises à jour selon le filtre.
#[tauri::command]
#[specta::specta]
pub async fn list_github_issues(
    root: String,
    filter: IssueFilter,
) -> Result<Vec<IssueSummary>, AppError> {
    blocking(move || github::issue_list(&user_gh(), Path::new(&root), filter)).await
}

/// Une issue avec ses commentaires.
#[tauri::command]
#[specta::specta]
pub async fn get_github_issue(root: String, number: u32) -> Result<Issue, AppError> {
    blocking(move || github::issue_view(&user_gh(), Path::new(&root), number)).await
}

/// Crée une issue (corps sur l'entrée standard de `gh`) et rend son numéro.
#[tauri::command]
#[specta::specta]
pub async fn create_github_issue(root: String, issue: NewIssue) -> Result<u32, AppError> {
    blocking(move || github::issue_create(&user_gh(), Path::new(&root), &issue)).await
}

/// Labels du dépôt (200 au plus).
#[tauri::command]
#[specta::specta]
pub async fn list_github_labels(root: String) -> Result<Vec<Label>, AppError> {
    blocking(move || github::label_list(&user_gh(), Path::new(&root))).await
}

/// Logins des personnes assignables du dépôt.
#[tauri::command]
#[specta::specta]
pub async fn list_github_assignees(root: String) -> Result<Vec<String>, AppError> {
    blocking(move || github::assignable_users(&user_gh(), Path::new(&root))).await
}

/// Login de l'utilisateur de `gh`.
#[tauri::command]
#[specta::specta]
pub async fn get_github_user(root: String) -> Result<String, AppError> {
    blocking(move || github::current_user(&user_gh(), Path::new(&root))).await
}

/// Modèles d'issue Markdown, lus à la racine du dépôt git du dossier racine.
#[tauri::command]
#[specta::specta]
pub async fn list_issue_templates(root: String) -> Result<Vec<IssueTemplate>, AppError> {
    blocking(move || Ok(github::list_issue_templates(&user_git(), Path::new(&root)))).await
}
