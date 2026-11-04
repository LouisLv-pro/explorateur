//! Écriture git (spec `git.md`, lot 2) : indexer, désindexer, annuler, committer.
//!
//! Toutes les commandes agissent sur tout le dépôt du dossier racine et sont lancées depuis
//! sa racine (décision 0007). Un échec de git rend `AppError::Git` avec sa sortie.
//!
//! Un bloc s'indexe, se désindexe ou s'annule par un patch d'un seul bloc construit ici,
//! appliqué par `git apply` (`--cached` pour l'index, `--reverse` pour défaire) : git refuse
//! un bloc périmé au lieu d'appliquer autre chose que ce qui est affiché.

use std::fmt::Write as _;

use serde::Deserialize;

use super::command::{Location, require_repo};
use super::{ChangeStatus, FileChange, Git, Hunk, LineKind};
use crate::{Failure, Result};

/// Options du commit (case « Modifier le dernier commit », bouton « Tout committer »).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    /// Remplace le dernier commit (`--amend`) ; un message vide garde l'ancien.
    pub amend: bool,
    /// Indexe d'abord toutes les modifications du dépôt, non suivis compris.
    pub all: bool,
}

pub(super) fn stage_file(git: &Git, root: &str, change: &FileChange) -> Result<()> {
    let location = require_repo(git, root)?;
    // `-A` : un fichier supprimé est indexé comme suppression ; un conflit, marqué résolu.
    git.write(&location.top, &["add", "-A", "--", &change.repo_path], None)?;
    Ok(())
}

pub(super) fn unstage_file(git: &Git, root: &str, change: &FileChange) -> Result<()> {
    let location = require_repo(git, root)?;
    let mut args = vec!["reset", "-q", "--", change.repo_path.as_str()];
    if let Some(orig) = change.orig_repo_path.as_deref() {
        args.push(orig);
    }
    if git.has_head(&location.top)? {
        git.write(&location.top, &args, None)?;
    } else {
        // Sans commit, il n'y a pas de HEAD où revenir : le fichier sort de l'index.
        let mut rm = vec!["rm", "--cached", "-q", "--"];
        rm.extend(&args[3..]);
        git.write(&location.top, &rm, None)?;
    }
    Ok(())
}

pub(super) fn stage_all(git: &Git, root: &str) -> Result<()> {
    let location = require_repo(git, root)?;
    // Sans chemin et depuis la racine du dépôt : tout le dépôt.
    git.write(&location.top, &["add", "-A"], None)?;
    Ok(())
}

pub(super) fn unstage_all(git: &Git, root: &str) -> Result<()> {
    let location = require_repo(git, root)?;
    if git.has_head(&location.top)? {
        git.write(&location.top, &["reset", "-q"], None)?;
    } else {
        git.write(&location.top, &["read-tree", "--empty"], None)?;
    }
    Ok(())
}

pub(super) fn stage_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    if is_whole_file(change) {
        // Ajout ou suppression : le diff n'a qu'un bloc, qui est tout le fichier.
        return stage_file(git, root, change);
    }
    let location = require_repo(git, root)?;
    apply(git, &location, change, hunk, &["--cached"])
}

pub(super) fn unstage_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    if is_whole_file(change) {
        return unstage_file(git, root, change);
    }
    let location = require_repo(git, root)?;
    apply(git, &location, change, hunk, &["--cached", "--reverse"])
}

pub(super) fn discard_file(
    git: &Git,
    root: &str,
    change: &FileChange,
    trash: &dyn Fn(&str) -> Result<()>,
) -> Result<()> {
    let location = require_repo(git, root)?;
    if change.status == ChangeStatus::Untracked {
        // Un dossier non suivi replié finit par `/` : la corbeille reçoit le chemin sans lui.
        let path = location.top.join(change.repo_path.trim_end_matches('/'));
        return trash(&path.to_string_lossy());
    }
    // Sans source : la version indexée revient sur le disque, l'index ne change pas.
    git.write(
        &location.top,
        &["checkout", "-q", "--", &change.repo_path],
        None,
    )?;
    Ok(())
}

pub(super) fn discard_hunk(git: &Git, root: &str, change: &FileChange, hunk: &Hunk) -> Result<()> {
    if change.status == ChangeStatus::Untracked {
        return Err(Failure::UntrackedHunk.into());
    }
    if change.status == ChangeStatus::Deleted {
        let location = require_repo(git, root)?;
        git.write(
            &location.top,
            &["checkout", "-q", "--", &change.repo_path],
            None,
        )?;
        return Ok(());
    }
    let location = require_repo(git, root)?;
    apply(git, &location, change, hunk, &["--reverse"])
}

pub(super) fn commit(
    git: &Git,
    root: &str,
    message: &str,
    options: CommitOptions,
) -> Result<String> {
    let location = require_repo(git, root)?;
    if options.all {
        git.write(&location.top, &["add", "-A"], None)?;
    }
    let keep_message = options.amend && message.trim().is_empty();
    let mut args = vec!["commit"];
    if options.amend {
        args.push("--amend");
    }
    if keep_message {
        args.push("--no-edit");
        git.write(&location.top, &args, None)?;
    } else {
        // Message sur l'entrée standard : ni découpé, ni lu comme une option.
        args.extend(["-F", "-"]);
        git.write(&location.top, &args, Some(message.as_bytes()))?;
    }
    let hash = git.run(&location.top, &["rev-parse", "--short", "HEAD"], false)?;
    Ok(String::from_utf8_lossy(&hash).trim().to_owned())
}

pub(super) fn last_commit_message(git: &Git, root: &str) -> Result<Option<String>> {
    let location = require_repo(git, root)?;
    if !git.has_head(&location.top)? {
        return Ok(None);
    }
    let out = git.run(&location.top, &["log", "-1", "--format=%B", "HEAD"], false)?;
    Ok(Some(
        String::from_utf8_lossy(&out)
            .trim_end_matches('\n')
            .to_owned(),
    ))
}

/// Ajout, suppression ou non suivi : un bloc couvre tout le fichier, il s'indexe en entier
/// (un patch sur `/dev/null` laisserait sinon un fichier vide dans l'index).
fn is_whole_file(change: &FileChange) -> bool {
    matches!(
        change.status,
        ChangeStatus::Untracked | ChangeStatus::Added | ChangeStatus::Deleted
    )
}

/// Applique le patch du seul bloc `hunk` (`flags` : `--cached`, `--reverse`).
fn apply(
    git: &Git,
    location: &Location,
    change: &FileChange,
    hunk: &Hunk,
    flags: &[&str],
) -> Result<()> {
    let reverse = flags.contains(&"--reverse");
    let patch = hunk_patch(&change.repo_path, hunk, reverse);
    let mut args = vec!["apply", "--whitespace=nowarn"];
    args.extend(flags);
    args.push("-");
    git.write(&location.top, &args, Some(patch.as_bytes()))?;
    Ok(())
}

/// Patch d'un seul bloc de `path` (relatif au dépôt).
///
/// Les autres blocs du diff ne sont pas appliqués : seuls les numéros du côté où le patch
/// s'applique restent justes (ancien côté à l'endroit, nouveau côté à l'envers). L'autre côté
/// est recalculé comme si ce bloc était seul.
fn hunk_patch(path: &str, hunk: &Hunk, reverse: bool) -> String {
    let (old_start, new_start) = if reverse {
        (
            lone_start(hunk.new_start, hunk.new_count, hunk.old_count),
            hunk.new_start,
        )
    } else {
        (
            hunk.old_start,
            lone_start(hunk.old_start, hunk.old_count, hunk.new_count),
        )
    };
    let a = quoted(&format!("a/{path}"));
    let b = quoted(&format!("b/{path}"));
    let mut patch = format!(
        "diff --git {a} {b}\n--- {a}\n+++ {b}\n@@ -{old_start},{} +{new_start},{} @@\n",
        hunk.old_count, hunk.new_count
    );
    for line in &hunk.lines {
        let prefix = match line.kind {
            LineKind::Context => ' ',
            LineKind::Removed => '-',
            LineKind::Added => '+',
        };
        let _ = writeln!(patch, "{prefix}{}", line.text);
        if line.no_newline {
            patch.push_str("\\ No newline at end of file\n");
        }
    }
    patch
}

/// Début de l'autre côté d'un bloc seul, d'après le côté connu (`start`, `count`).
/// Un côté sans ligne a pour début la ligne qui le précède (convention de `diff -u`).
fn lone_start(start: u32, count: u32, other_count: u32) -> u32 {
    let before = if count == 0 {
        start
    } else {
        start.saturating_sub(1)
    };
    if other_count == 0 { before } else { before + 1 }
}

/// Nom de fichier cité à la façon de git (`"a/mon \"fichier\"\t.txt"`) : `git apply` le lit
/// sans s'arrêter aux espaces ni aux tabulations.
fn quoted(name: &str) -> String {
    let mut out = String::from("\"");
    for c in name.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if c.is_ascii_control() => {
                let _ = write!(out, "\\{:03o}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
