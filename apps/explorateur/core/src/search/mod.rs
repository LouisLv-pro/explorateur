//! Recherche rapide de fichier : correspondance floue sur le chemin relatif
//! (spec `recherche-rapide.md`).

use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

use crate::git::Git;
use crate::tree::is_hidden;
use crate::{AppError, Result};

mod content;

pub use content::{ContentSearch, FileHits, Hit, search_content, search_content_git};

/// Nombre maximal de résultats renvoyés.
const MAX_RESULTS: usize = 50;
/// Nombre maximal de fichiers examinés, puis le parcours s'arrête.
const MAX_SCANNED: usize = 50_000;

/// Points pour toute lettre trouvée.
const BASE: i32 = 1;
/// Lettre au début du chemin ou du nom, après `/ - _ .`, ou passage minuscule → majuscule.
const WORD_START: i32 = 10;
/// Lettre dans le nom du fichier (après le dernier `/`).
const IN_NAME: i32 = 6;
/// Lettre qui suit directement la lettre précédente de la requête.
const CONSECUTIVE: i32 = 15;
/// Pénalité maximale pour les lettres sautées entre deux correspondances.
const MAX_GAP_PENALTY: usize = 5;

/// Fichier trouvé par la recherche.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FileMatch {
    /// Chemin absolu.
    pub path: String,
    /// Chemin relatif à la racine, séparé par `/`.
    pub relative_path: String,
    /// Plus il est grand, meilleure est la correspondance.
    pub score: i32,
    /// Indices (en caractères) des lettres de `relative_path` qui correspondent.
    pub matched: Vec<u32>,
}

/// Fichiers de `root` dont le chemin relatif contient les lettres de `query` dans l'ordre
/// (casse, accents et espaces ignorés), les meilleurs d'abord, 50 au plus.
pub fn find_files(root: &str, query: &str, show_hidden: bool) -> Result<Vec<FileMatch>> {
    find_matches(root, query, |root_path| walk(root_path, show_hidden))
}

/// Comme `find_files`, mais dans un dépôt git les fichiers ignorés par git sont traités comme
/// des éléments masqués (absents sauf `show_hidden`). Hors dépôt ou git absent : `find_files`.
pub fn find_files_git(
    git: &Git,
    root: &str,
    query: &str,
    show_hidden: bool,
) -> Result<Vec<FileMatch>> {
    find_matches(root, query, |root_path| {
        files_of(git, root_path, show_hidden)
    })
}

/// Fichiers à examiner : le parcours du disque, sauf dans un dépôt sans `show_hidden`, où la
/// liste vient de git (ignorés exclus). Avec `show_hidden`, tout se voit : git n'est pas lancé.
fn files_of(git: &Git, root: &Path, show_hidden: bool) -> Vec<PathBuf> {
    if !show_hidden && let Some(files) = git_files(git, root) {
        return files;
    }
    walk(root, show_hidden)
}

/// Fichiers de `root` selon git, ou `None` hors dépôt. Garde les règles des éléments masqués
/// (dossiers bruyants, noms en `.`), écarte ce qui n'est plus un fichier sur le disque (suivi
/// supprimé, sous-module) et s'arrête à `MAX_SCANNED`.
fn git_files(git: &Git, root: &Path) -> Option<Vec<PathBuf>> {
    let listed = crate::git::list_unignored_files(git, &root.to_string_lossy())?;
    Some(
        listed
            .iter()
            .filter(|relative| !has_hidden_component(relative))
            .map(|relative| root.join(relative))
            // `metadata` suit les liens : un lien vers un fichier compte comme un fichier.
            .filter(|path| fs::metadata(path).is_ok_and(|m| m.is_file()))
            .take(MAX_SCANNED)
            .collect(),
    )
}

/// Vrai si un dossier du chemin (`a/b/c.txt` : `a` et `b`) ou son nom de fichier est masqué.
fn has_hidden_component(relative: &str) -> bool {
    let mut parts = relative.split('/').peekable();
    while let Some(name) = parts.next() {
        if is_hidden(name, parts.peek().is_some()) {
            return true;
        }
    }
    false
}

fn find_matches(
    root: &str,
    query: &str,
    list_files: impl FnOnce(&Path) -> Vec<PathBuf>,
) -> Result<Vec<FileMatch>> {
    let meta = fs::metadata(root).map_err(|e| AppError::from_io(&e, root))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory(root.to_owned()));
    }

    let query: Vec<char> = query
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(fold_char)
        .collect();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let root_path = Path::new(root);
    let mut matches = Vec::new();
    for file in list_files(root_path) {
        let relative = relative_with_slashes(root_path, &file);
        if let Some((score, matched)) = best_alignment(&relative, &query) {
            matches.push(FileMatch {
                path: file.to_string_lossy().into_owned(),
                relative_path: relative,
                score,
                matched,
            });
        }
    }

    matches.sort_by(|a, b| {
        Reverse(a.score)
            .cmp(&Reverse(b.score))
            .then_with(|| {
                a.relative_path
                    .chars()
                    .count()
                    .cmp(&b.relative_path.chars().count())
            })
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    matches.truncate(MAX_RESULTS);
    Ok(matches)
}

/// Fichiers sous `root`, sans suivre les liens vers des dossiers. Un dossier illisible est sauté.
fn walk(root: &Path, show_hidden: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(reader) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in reader.filter_map(std::result::Result::ok) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if file_type.is_dir() {
                if show_hidden || !is_hidden(&name, true) {
                    pending.push(path);
                }
                continue;
            }
            // Un lien vers un fichier compte comme un fichier ; un lien vers un dossier
            // (ou cassé) est ignoré, ce qui évite toute boucle.
            let is_file = file_type.is_file() || fs::metadata(&path).is_ok_and(|m| m.is_file());
            if !is_file || (!show_hidden && is_hidden(&name, false)) {
                continue;
            }
            files.push(path);
            if files.len() >= MAX_SCANNED {
                return files;
            }
        }
    }
    files
}

/// Chemin de `file` relatif à `root`, composants joints par `/`.
fn relative_with_slashes(root: &Path, file: &Path) -> String {
    let relative = file.strip_prefix(root).unwrap_or(file);
    relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Un caractère en minuscule sans accent (`É` → `e`). Un seul caractère en sortie, pour que
/// les indices restent ceux du texte d'origine.
fn fold_char(c: char) -> char {
    std::iter::once(c)
        .nfd()
        .filter(|d| !is_combining_mark(*d))
        .flat_map(char::to_lowercase)
        .next()
        .unwrap_or(c)
}

/// Meilleur placement des lettres de `query` (déjà dépliée) dans `path` : score et indices.
/// `None` si les lettres n'apparaissent pas dans l'ordre.
fn best_alignment(path: &str, query: &[char]) -> Option<(i32, Vec<u32>)> {
    let original: Vec<char> = path.chars().collect();
    let folded: Vec<char> = original.iter().copied().map(fold_char).collect();
    if query.len() > original.len() {
        return None;
    }

    let name_start = original
        .iter()
        .rposition(|c| *c == '/')
        .map_or(0, |i| i + 1);
    let letter_score: Vec<i32> = (0..original.len())
        .map(|i| {
            let starts_word = i == 0
                || matches!(original[i - 1], '/' | '-' | '_' | '.')
                || (original[i - 1].is_lowercase() && original[i].is_uppercase());
            BASE + if starts_word { WORD_START } else { 0 }
                + if i >= name_start { IN_NAME } else { 0 }
        })
        .collect();

    // best[k][i] : meilleur score avec la lettre k de la requête placée en i, et la position
    // de la lettre k - 1.
    let mut best: Vec<Vec<Option<(i32, usize)>>> = vec![vec![None; original.len()]; query.len()];
    for (k, wanted) in query.iter().enumerate() {
        for i in 0..original.len() {
            if folded[i] != *wanted {
                continue;
            }
            best[k][i] = if k == 0 {
                Some((letter_score[i], i))
            } else {
                (0..i)
                    .filter_map(|j| {
                        let (previous, _) = best[k - 1][j]?;
                        let link = if j + 1 == i {
                            CONSECUTIVE
                        } else {
                            -i32::try_from((i - j - 1).min(MAX_GAP_PENALTY)).unwrap_or(0)
                        };
                        Some((previous + link + letter_score[i], j))
                    })
                    .max_by_key(|(score, _)| *score)
            };
        }
    }

    let last = query.len() - 1;
    let (mut position, (score, _)) = best[last]
        .iter()
        .enumerate()
        .filter_map(|(i, cell)| cell.map(|c| (i, c)))
        .max_by_key(|(_, (score, _))| *score)?;

    let mut matched = vec![0_u32; query.len()];
    for k in (0..query.len()).rev() {
        matched[k] = u32::try_from(position).unwrap_or(u32::MAX);
        position = best[k][position]?.1;
    }
    Some((score, matched))
}
