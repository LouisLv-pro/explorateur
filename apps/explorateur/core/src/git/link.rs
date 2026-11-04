//! Ce que git sait d'un fichier pour fabriquer son lien GitHub (spec `issues-github.md`, lot 3).

use serde::Serialize;

use super::Git;
use super::command::{Located, locate};
use crate::{AppError, Result};

/// Chemin dans le dépôt, hash de HEAD et état d'un fichier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileLinkInfo {
    /// Chemin du fichier depuis la racine du dépôt (le dossier racine peut être un
    /// sous-dossier), séparé par `/`, non encodé.
    pub repo_path: String,
    /// Hash complet de HEAD (`None` : dépôt sans commit).
    pub head: Option<String>,
    /// Le fichier existe dans HEAD. Un fichier non suivi ou seulement indexé n'est pas sur GitHub.
    pub tracked: bool,
    /// Le disque diffère de HEAD (modification indexée ou non).
    pub modified: bool,
}

pub(super) fn file_link_info(git: &Git, root: &str, path: &str) -> Result<Option<FileLinkInfo>> {
    let location = match locate(git, root)? {
        Located::Repo(location) => location,
        Located::NotARepo | Located::GitNotFound => return Ok(None),
    };
    let io = |e: std::io::Error| AppError::Io(format!("git: {e}"));
    let repo_path = format!("{}{path}", location.prefix);

    let head_out = git
        .output(&location.top, &["rev-parse", "--verify", "-q", "HEAD"])
        .map_err(io)?;
    let head = head_out
        .status
        .success()
        .then(|| String::from_utf8_lossy(&head_out.stdout).trim().to_owned());
    let Some(head_hash) = head.as_deref() else {
        return Ok(Some(FileLinkInfo {
            repo_path,
            head: None,
            tracked: false,
            modified: false,
        }));
    };

    // `HEAD:<chemin>` n'existe que si le fichier est dans le dernier commit.
    let object = format!("{head_hash}:{repo_path}");
    let tracked = git
        .output(&location.top, &["cat-file", "-e", &object])
        .map_err(io)?
        .status
        .success();
    // `diff --quiet` rend 1 quand le disque diffère de HEAD.
    let modified = tracked
        && git
            .output(
                &location.top,
                &["diff", "--quiet", "HEAD", "--", &repo_path],
            )
            .map_err(io)?
            .status
            .code()
            == Some(1);
    Ok(Some(FileLinkInfo {
        repo_path,
        head,
        tracked,
        modified,
    }))
}
