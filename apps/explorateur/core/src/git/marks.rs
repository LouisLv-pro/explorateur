//! Repères git (spec `git.md`, lot 3) : statut par chemin pour l'arborescence et les onglets,
//! texte indexé d'un fichier et blocs de la gouttière de l'éditeur (crate `similar`,
//! décision 0007).

use std::collections::BTreeMap;
use std::ops::Range;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use similar::{Algorithm, DiffTag, capture_diff_slices_deadline};

use super::command::{Located, locate};
use super::status::Porcelain;
use super::{ChangeStatus, Git};
use crate::{AppError, Result};

/// Repères de l'arborescence et des onglets pour un dossier racine. Chemins séparés par `/`,
/// relatifs au dossier racine ; chaque liste est triée par chemin. Seul un dossier non suivi
/// replié (plus de 50 fichiers, `files`) garde un `/` final : les fichiers en dessous ne sont
/// pas listés. Rien hors du dossier racine, ni le dossier racine lui-même (un dossier racine
/// situé dans un dossier non suivi replié n'a donc aucun repère).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PathStatuses {
    /// Fichiers modifiés, un statut chacun, plus les dossiers non suivis repliés (`gen/`,
    /// avec `/` final). Priorité quand git en donne plusieurs (indexé et disque) : conflit,
    /// puis non suivi / ajouté / renommé, puis modifié, puis supprimé. Un renommé est repéré à
    /// son nouveau chemin.
    pub files: Vec<PathMark>,
    /// Dossiers qui contiennent au moins un fichier de `files` (ancêtres compris, sans `/`
    /// final), avec le statut le plus fort de leurs fichiers, même priorité. Un dossier non
    /// suivi replié est lui-même dedans (`gen`).
    pub dirs: Vec<PathMark>,
    /// Entrées ignorées par `.gitignore` : un dossier ignoré entier est donné seul, pas
    /// fichier par fichier (`git status --ignored=matching`).
    pub ignored: Vec<String>,
}

/// Un chemin et son statut de repère.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PathMark {
    pub path: String,
    pub status: ChangeStatus,
}

/// Type d'un bloc de la gouttière.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GutterKind {
    /// Barre verte : lignes absentes du texte indexé.
    Added,
    /// Barre bleue : lignes qui remplacent des lignes du texte indexé.
    Modified,
    /// Triangle rouge : des lignes du texte indexé ont disparu.
    Deleted,
}

/// Bloc de la gouttière, en lignes 1-indexées du texte de l'éditeur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GutterBlock {
    pub kind: GutterKind,
    /// Première ligne du bloc. Suppression : ligne après laquelle des lignes ont disparu
    /// (0 si en tête) ; `end_line` vaut alors `start_line`.
    pub start_line: u32,
    /// Dernière ligne du bloc (incluse).
    pub end_line: u32,
    /// Texte indexé remplacé par le bloc, fins de ligne comprises telles quelles (vide pour un
    /// ajout). « Annuler ce bloc » : remplacer les lignes `start_line..=end_line` (fins de ligne
    /// comprises) par ce texte ; pour une suppression, l'insérer avant la ligne
    /// `start_line + 1`.
    pub original: String,
}

/// Temps maximal du diff de lignes de la gouttière (recalculé à chaque frappe) : au-delà,
/// `similar` donne un diff approché, toujours correct mais moins fin.
const GUTTER_TIMEOUT: Duration = Duration::from_millis(200);

/// Repères d'un `git status` déjà lu (`prefix` : dossier racine relatif au dépôt, avec `/`
/// final, vide à la racine du dépôt). Seuls les chemins sous le dossier racine sont gardés.
pub(super) fn build_marks(parsed: &Porcelain, prefix: &str) -> PathStatuses {
    // Un statut par fichier : le plus fort de ses entrées (indexée, disque, non suivie).
    let mut files: BTreeMap<String, ChangeStatus> = BTreeMap::new();
    for entry in &parsed.entries {
        if let Some(path) = under_root(&entry.repo_path, prefix) {
            keep_strongest(&mut files, path, entry.status);
        }
    }
    let mut dirs: BTreeMap<String, ChangeStatus> = BTreeMap::new();
    for (path, &status) in &files {
        // Un dossier non suivi replié (`gen/`) est lui-même un dossier à repérer.
        let mut ancestor = path.trim_end_matches('/');
        if ancestor.len() < path.len() {
            keep_strongest(&mut dirs, ancestor, status);
        }
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            keep_strongest(&mut dirs, parent, status);
            ancestor = parent;
        }
    }
    let mut ignored: Vec<String> = parsed
        .ignored
        .iter()
        .filter_map(|path| under_root(path.trim_end_matches('/'), prefix))
        .map(str::to_owned)
        .collect();
    ignored.sort();
    PathStatuses {
        files: into_marks(files),
        dirs: into_marks(dirs),
        ignored,
    }
}

pub(super) fn get_index_text(git: &Git, root: &str, path: &str) -> Result<Option<String>> {
    let location = match locate(git, root)? {
        Located::Repo(location) => location,
        Located::NotARepo | Located::GitNotFound => return Ok(None),
    };
    // `:<chemin>` est l'étape 0 de l'index : absente pour un non suivi ou un conflit.
    let object = format!(":{}{path}", location.prefix);
    let out = git
        .output(&location.top, &["cat-file", "blob", &object])
        .map_err(|e| AppError::Io(format!("git: {e}")))?;
    if !out.status.success() {
        return Ok(None);
    }
    // Un binaire (non UTF-8) n'a pas de gouttière.
    Ok(String::from_utf8(out.stdout).ok())
}

pub(super) fn gutter_blocks(index_text: &str, editor_text: &str) -> Vec<GutterBlock> {
    let old: Vec<&str> = index_text.split_inclusive('\n').collect();
    let new: Vec<&str> = editor_text.split_inclusive('\n').collect();
    let deadline = Instant::now().checked_add(GUTTER_TIMEOUT);
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &old, &new, deadline);

    let mut blocks = Vec::new();
    // Bloc en cours : plages de lignes (0-indexées) des deux côtés, réunies jusqu'à l'égalité
    // suivante (une suppression suivie d'un ajout forme un seul bloc modifié).
    let mut pending: Option<(Range<usize>, Range<usize>)> = None;
    for op in &ops {
        let (tag, old_range, new_range) = op.as_tag_tuple();
        if tag == DiffTag::Equal {
            if let Some((o, n)) = pending.take() {
                blocks.push(gutter_block(&old, o, n));
            }
            continue;
        }
        pending = Some(match pending {
            Some((o, n)) => (o.start..old_range.end, n.start..new_range.end),
            None => (old_range, new_range),
        });
    }
    if let Some((o, n)) = pending {
        blocks.push(gutter_block(&old, o, n));
    }
    blocks
}

/// Bloc de gouttière d'un changement : lignes `old` du texte indexé remplacées par les lignes
/// `new` de l'éditeur (plages 0-indexées).
fn gutter_block(old_lines: &[&str], old: Range<usize>, new: Range<usize>) -> GutterBlock {
    let original = old_lines.get(old.clone()).unwrap_or_default().concat();
    let line = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let (kind, start_line, end_line) = if old.is_empty() {
        (GutterKind::Added, line(new.start + 1), line(new.end))
    } else if new.is_empty() {
        (GutterKind::Deleted, line(new.start), line(new.start))
    } else {
        (GutterKind::Modified, line(new.start + 1), line(new.end))
    };
    GutterBlock {
        kind,
        start_line,
        end_line,
        original,
    }
}

/// Chemin relatif au dossier racine, `None` hors de lui ou pour le dossier racine lui-même.
fn under_root<'a>(repo_path: &'a str, prefix: &str) -> Option<&'a str> {
    repo_path
        .strip_prefix(prefix)
        .filter(|rest| !rest.is_empty())
}

/// Force d'un statut de repère : conflit, puis non suivi / ajouté / renommé, puis modifié,
/// puis supprimé.
fn strength(status: ChangeStatus) -> u8 {
    match status {
        ChangeStatus::Conflict => 3,
        ChangeStatus::Untracked | ChangeStatus::Added | ChangeStatus::Renamed => 2,
        ChangeStatus::Modified => 1,
        ChangeStatus::Deleted => 0,
    }
}

fn keep_strongest(map: &mut BTreeMap<String, ChangeStatus>, path: &str, status: ChangeStatus) {
    match map.get_mut(path) {
        Some(current) if strength(status) > strength(*current) => *current = status,
        Some(_) => {}
        None => {
            map.insert(path.to_owned(), status);
        }
    }
}

fn into_marks(map: BTreeMap<String, ChangeStatus>) -> Vec<PathMark> {
    map.into_iter()
        .map(|(path, status)| PathMark { path, status })
        .collect()
}
