//! Ouverture de chemins reçus du Finder, d'un lien ou de la CLI (specs
//! `ouvrir-depuis-finder.md` et `ouvrir-depuis-terminal.md`) : choix du dossier racine, des
//! fichiers à ouvrir et de la ligne à montrer.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::{self, Git};
use crate::preview::PreviewKind;
use crate::tree::Entry;

/// Dossier racine à afficher et fichiers à y ouvrir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct OpenTarget {
    /// Chemin absolu normalisé.
    pub root: String,
    /// Fichiers reçus situés sous `root`, dans l'ordre reçu, sans doublon.
    pub files: Vec<Entry>,
    /// Ligne à montrer dans le dernier fichier de `files` (à partir de 1).
    // Facultatifs côté TypeScript : les cibles écrites à la main (tests) peuvent s'en passer.
    #[specta(optional)]
    pub line: Option<u32>,
    /// Colonne demandée avec la ligne (lue, pas encore appliquée).
    #[specta(optional)]
    pub column: Option<u32>,
    /// Vrai si au moins une demande vient d'un lien ou de la CLI (pas du Finder).
    #[specta(optional)]
    pub link: bool,
}

/// Demande d'ouverture d'un chemin : Finder (`link: false`), lien ou CLI (`link: true`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenRequest {
    pub path: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub link: bool,
}

/// Comme `resolve_open` sur les chemins de `requests`, avec la ligne et la colonne de la
/// dernière demande si elle désigne le dernier fichier ouvert (celui qui devient courant).
pub fn resolve_requests(
    git: &Git,
    current_root: Option<&str>,
    requests: &[OpenRequest],
) -> Option<OpenTarget> {
    let paths: Vec<String> = requests.iter().map(|r| r.path.clone()).collect();
    let mut target = resolve_open(git, current_root, &paths)?;
    target.link = requests.iter().any(|r| r.link);
    if let (Some(last), Some(file)) = (requests.last(), target.files.last()) {
        let is_current = Path::new(&last.path).is_absolute()
            && fs::canonicalize(&last.path).is_ok_and(|p| p == Path::new(&file.path));
        if is_current {
            target.line = last.line;
            target.column = last.column;
        }
    }
    Some(target)
}

/// Cible d'ouverture pour `paths` (chemins absolus, dans l'ordre reçu). `None` si aucun n'existe.
///
/// Le premier chemin existant fixe la racine : un dossier est la racine lui-même ; un fichier
/// garde `current_root` s'il est dessous, sinon prend la racine de son dépôt git, sinon son
/// dossier parent. Les autres chemins ne comptent que s'ils sont des fichiers sous cette racine.
pub fn resolve_open(git: &Git, current_root: Option<&str>, paths: &[String]) -> Option<OpenTarget> {
    // Chemins normalisés (liens suivis) : deux formes du même chemin deviennent égales.
    // Un chemin relatif dépendrait du dossier courant du processus : écarté, comme un absent.
    let existing: Vec<PathBuf> = paths
        .iter()
        .filter(|p| Path::new(p).is_absolute())
        .filter_map(|p| fs::canonicalize(p).ok())
        .collect();
    let first = existing.first()?;

    let root = if first.is_dir() {
        first.clone()
    } else {
        let current = current_root
            .and_then(|r| fs::canonicalize(r).ok())
            .filter(|r| r.is_dir());
        match current {
            // `starts_with` compare par composants : `/a/projet-2` n'est pas sous `/a/projet`.
            Some(current) if first.starts_with(&current) => current,
            _ => repo_root_of(git, first)?,
        }
    };

    let mut seen = HashSet::new();
    let files = existing
        .iter()
        .filter(|p| p.starts_with(&root) && !p.is_dir())
        .filter(|p| seen.insert(p.as_path()))
        .map(|p| file_entry(p))
        .collect();

    Some(OpenTarget {
        root: root.to_string_lossy().into_owned(),
        files,
        line: None,
        column: None,
        link: false,
    })
}

/// Racine du dépôt git qui contient le fichier `file`, sinon son dossier parent.
fn repo_root_of(git: &Git, file: &Path) -> Option<PathBuf> {
    let parent = file.parent()?;
    Some(
        git::repo_top(git, parent)
            .and_then(|top| fs::canonicalize(top).ok())
            .unwrap_or_else(|| parent.to_path_buf()),
    )
}

/// Entrée de fichier, construite comme celles de l'arborescence.
fn file_entry(path: &Path) -> Entry {
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    Entry {
        preview_kind: Some(PreviewKind::from_name(&name)),
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir: false,
    }
}
