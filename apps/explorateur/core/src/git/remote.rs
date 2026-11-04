//! Branche distante (spec `git-distant.md`, décision 0010) : état lu sur le disque, récupérer,
//! pousser, publier, tirer. Le réseau passe par le `git` de l'utilisateur (`Git::network`).

use std::path::Path;

use serde::Serialize;

use super::Git;
use super::command::{Located, Location, locate, require_repo};
use crate::{AppError, Failure, Result};

/// État réseau de la branche courante.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RemoteState {
    /// Aucun geste réseau : HEAD détaché, dépôt sans remote, ou dossier hors dépôt.
    None,
    /// Amont de la branche (`origin/main`), commits à pousser et à tirer, comparés à la
    /// dernière récupération.
    Upstream {
        name: String,
        ahead: u32,
        behind: u32,
    },
    /// Branche sans amont : remote où la publier (`origin`, sinon le seul remote).
    Publishable { remote: String },
    /// Branche sans amont, plusieurs remotes sans `origin`.
    AmbiguousRemote,
}

/// Genre d'une erreur de geste réseau.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RemoteErrorKind {
    /// Push refusé : le distant a avancé.
    Rejected,
    /// Authentification refusée ou demandée.
    Auth,
    /// Remote injoignable (hors ligne, dépôt absent).
    Unreachable,
    /// Délai dépassé, git arrêté.
    Timeout,
    /// Pull impossible en fast-forward.
    Diverged,
    /// Pull qui écraserait des modifications locales.
    LocalChanges,
    /// Aucun remote.
    NoRemote,
    /// Publication avec plusieurs remotes sans `origin`.
    AmbiguousRemote,
    /// Le reste (ex. hook `pre-push` refusé).
    Other,
}

/// Reconnaît le genre d'une sortie d'erreur de git (`LC_ALL=C`). L'ordre compte : une clé SSH
/// refusée finit aussi par « Could not read from remote repository ».
pub fn classify_remote_error(output: &str) -> RemoteErrorKind {
    let has = |needles: &[&str]| needles.iter().any(|n| output.contains(n));
    if has(&[
        "terminal prompts disabled",
        "could not read Username",
        "could not read Password",
        "Authentication failed",
        "Invalid username or token",
        "Permission denied (",
        "Host key verification failed",
    ]) {
        RemoteErrorKind::Auth
    } else if output.contains("[rejected]")
        && has(&["fetch first", "non-fast-forward", "Updates were rejected"])
    {
        RemoteErrorKind::Rejected
    } else if has(&["Not possible to fast-forward", "Diverging branches"]) {
        RemoteErrorKind::Diverged
    } else if has(&["would be overwritten by"]) {
        RemoteErrorKind::LocalChanges
    } else if has(&[
        "No configured push destination",
        "No remote repository specified",
    ]) {
        RemoteErrorKind::NoRemote
    } else if has(&[
        "Could not resolve host",
        "Failed to connect",
        "Network is unreachable",
        "Connection refused",
        "Connection timed out",
        "Connection reset",
        "does not appear to be a git repository",
        "Could not read from remote repository",
    ]) {
        RemoteErrorKind::Unreachable
    } else {
        RemoteErrorKind::Other
    }
}

/// Ce que `git status --branch` dit de la branche courante.
#[derive(Debug, Default, PartialEq, Eq)]
struct BranchInfo {
    /// `None` si HEAD est détaché.
    branch: Option<String>,
    /// Amont et compteurs (`# branch.upstream`, `# branch.ab +A -B`).
    upstream: Option<(String, u32, u32)>,
}

fn parse_branch_info(text: &str) -> BranchInfo {
    let mut info = BranchInfo::default();
    let mut name = None;
    let mut counts = (0, 0);
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            info.branch = (head != "(detached)").then(|| head.to_owned());
        } else if let Some(up) = line.strip_prefix("# branch.upstream ") {
            name = Some(up.to_owned());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            // `+A -B`
            let mut parts = ab.split(' ');
            let number = |p: Option<&str>, sign: char| {
                p.and_then(|p| p.strip_prefix(sign))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0)
            };
            counts = (number(parts.next(), '+'), number(parts.next(), '-'));
        }
    }
    info.upstream = name.map(|n| (n, counts.0, counts.1));
    info
}

fn branch_info(git: &Git, top: &Path) -> Result<BranchInfo> {
    let raw = git.run(
        top,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=no",
        ],
        false,
    )?;
    Ok(parse_branch_info(&String::from_utf8_lossy(&raw)))
}

/// Remotes du dépôt (`git remote`).
fn remotes(git: &Git, top: &Path) -> Result<Vec<String>> {
    let raw = git.run(top, &["remote"], false)?;
    Ok(String::from_utf8_lossy(&raw)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect())
}

/// Remote choisi sans amont : `origin` s'il existe, sinon le seul remote.
enum Pick {
    Missing,
    One(String),
    Ambiguous,
}

fn pick_remote(remotes: &[String]) -> Pick {
    if remotes.iter().any(|r| r == "origin") {
        Pick::One("origin".to_owned())
    } else {
        match remotes {
            [] => Pick::Missing,
            [only] => Pick::One(only.clone()),
            _ => Pick::Ambiguous,
        }
    }
}

fn refusal(kind: RemoteErrorKind) -> AppError {
    AppError::Remote {
        kind,
        output: String::new(),
    }
}

/// Remote à utiliser sans amont, ou le refus à rendre.
fn remote_or_refusal(remotes: &[String]) -> Result<String> {
    match pick_remote(remotes) {
        Pick::One(remote) => Ok(remote),
        Pick::Missing => Err(refusal(RemoteErrorKind::NoRemote)),
        Pick::Ambiguous => Err(refusal(RemoteErrorKind::AmbiguousRemote)),
    }
}

pub(super) fn get_remote_state(git: &Git, root: &str) -> Result<RemoteState> {
    let location = match locate(git, root)? {
        Located::Repo(location) => location,
        Located::NotARepo | Located::GitNotFound => return Ok(RemoteState::None),
    };
    let top = &location.top;
    let info = branch_info(git, top)?;
    if info.branch.is_none() {
        return Ok(RemoteState::None);
    }
    if let Some((name, ahead, behind)) = info.upstream {
        return Ok(RemoteState::Upstream {
            name,
            ahead,
            behind,
        });
    }
    Ok(match pick_remote(&remotes(git, top)?) {
        Pick::Missing => RemoteState::None,
        Pick::One(remote) => RemoteState::Publishable { remote },
        Pick::Ambiguous => RemoteState::AmbiguousRemote,
    })
}

pub(super) fn git_fetch(git: &Git, root: &str) -> Result<()> {
    let Location { top, .. } = require_repo(git, root)?;
    let info = branch_info(git, &top)?;
    let remote = match (&info.branch, &info.upstream) {
        (Some(branch), Some(_)) => upstream_remote(git, &top, branch)?,
        _ => None,
    };
    let remote = match remote {
        Some(remote) => remote,
        None => remote_or_refusal(&remotes(git, &top)?)?,
    };
    git.network(&top, &["fetch", "--prune", &remote])?;
    Ok(())
}

/// Remote de l'amont de `branch` (`origin` pour `origin/main`), lu dans la configuration.
fn upstream_remote(git: &Git, top: &Path, branch: &str) -> Result<Option<String>> {
    let reference = format!("refs/heads/{branch}");
    let raw = git.run(
        top,
        &[
            "for-each-ref",
            "--format=%(upstream:remotename)",
            &reference,
        ],
        false,
    )?;
    let name = String::from_utf8_lossy(&raw).trim().to_owned();
    Ok((!name.is_empty()).then_some(name))
}

pub(super) fn git_push(git: &Git, root: &str) -> Result<()> {
    let Location { top, .. } = require_repo(git, root)?;
    let info = branch_info(git, &top)?;
    let Some(branch) = info.branch else {
        return Err(Failure::DetachedHead.into());
    };
    if info.upstream.is_some() {
        git.network(&top, &["push"])?;
    } else {
        let remote = remote_or_refusal(&remotes(git, &top)?)?;
        git.network(&top, &["push", "-u", &remote, &branch])?;
    }
    Ok(())
}

pub(super) fn git_pull(git: &Git, root: &str) -> Result<u32> {
    let Location { top, .. } = require_repo(git, root)?;
    if branch_info(git, &top)?.upstream.is_none() && remotes(git, &top)?.is_empty() {
        return Err(refusal(RemoteErrorKind::NoRemote));
    }
    let before = head_rev(git, &top)?;
    git.network(&top, &["pull", "--ff-only"])?;
    let after = head_rev(git, &top)?;
    if before == after {
        return Ok(0);
    }
    let range = format!("{before}..{after}");
    let raw = git.run(&top, &["rev-list", "--count", &range], false)?;
    Ok(String::from_utf8_lossy(&raw).trim().parse().unwrap_or(0))
}

fn head_rev(git: &Git, top: &Path) -> Result<String> {
    let raw = git.run(top, &["rev-parse", "HEAD"], false)?;
    Ok(String::from_utf8_lossy(&raw).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_la_branche_l_amont_et_les_compteurs() {
        let text = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n";
        assert_eq!(
            parse_branch_info(text),
            BranchInfo {
                branch: Some("main".to_owned()),
                upstream: Some(("origin/main".to_owned(), 2, 1)),
            }
        );
    }

    #[test]
    fn head_detache_n_a_pas_de_branche() {
        let info = parse_branch_info("# branch.oid abc\n# branch.head (detached)\n");
        assert_eq!(info, BranchInfo::default());
    }
}
