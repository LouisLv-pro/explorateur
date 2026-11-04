//! Fichiers modifiés depuis la dernière lecture (spec `derniere-lecture.md`).
//!
//! Mémoire de session, sans base : chaque lecture garde la version lue (révision et, si
//! l'aperçu le lirait en texte, le texte) ; les changements disque posent des pastilles.

mod diff;

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::git::DiffContent;
use crate::preview::{read_text_file, revision_of};
use crate::tree::is_hidden;
use crate::{AppError, Result};

/// Plafond par défaut du texte gardé : 64 Mio.
const DEFAULT_TEXT_CAP: usize = 64 * 1024 * 1024;

/// Résultat d'une lecture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum ReadOutcome {
    /// Même contenu que la version lue précédente.
    Unchanged,
    /// Texte changé : diff de l'ancienne version lue à la version actuelle.
    Changed {
        diff: DiffContent,
        added: u32,
        removed: u32,
    },
    /// Changé, mais pas de texte d'un côté (binaire, image, plus de 2 Mio, oublié).
    ChangedNoDiff,
    /// Aucune version lue avant. `touched` : il portait la pastille « jamais lu ».
    FirstRead { touched: bool },
}

/// Pastilles sous un dossier racine : chemins absolus triés.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct ReadMarks {
    /// Fichiers modifiés depuis leur dernière lecture, ou jamais lus et touchés.
    pub files: Vec<String>,
    /// Dossiers ancêtres de ces fichiers, sous le dossier racine (lui exclu).
    pub dirs: Vec<String>,
}

/// Version lue d'un fichier.
struct ReadVersion {
    revision: String,
    text: Option<String>,
    /// Ordre de la lecture : le plus petit est le plus ancien (oublié en premier).
    seq: u64,
}

/// Suivi des lectures de la session.
pub struct ReadTracker {
    root: Option<PathBuf>,
    /// Versions lues, par chemin absolu ; survivent à un changement de dossier racine.
    versions: HashMap<String, ReadVersion>,
    /// Fichiers lus dont le disque diffère de la version lue.
    changed: BTreeSet<String>,
    /// Fichiers jamais lus touchés depuis l'ouverture du dossier racine.
    touched: BTreeSet<String>,
    text_bytes: usize,
    text_cap: usize,
    next_seq: u64,
}

impl Default for ReadTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl ReadTracker {
    /// Suivi vide, plafond de texte de 64 Mio.
    pub fn new() -> Self {
        Self::with_text_cap(DEFAULT_TEXT_CAP)
    }

    /// Suivi vide avec un plafond de texte gardé de `cap` octets.
    pub fn with_text_cap(cap: usize) -> Self {
        Self {
            root: None,
            versions: HashMap::new(),
            changed: BTreeSet::new(),
            touched: BTreeSet::new(),
            text_bytes: 0,
            text_cap: cap,
            next_seq: 0,
        }
    }

    /// Nouveau dossier racine : les pastilles « jamais lu » sont effacées.
    pub fn set_root(&mut self, root: &str) {
        self.root = Some(PathBuf::from(root));
        self.touched.clear();
    }

    /// Met à jour les pastilles des chemins touchés d'après le disque.
    pub fn note_changes(&mut self, paths: &[String]) {
        for path in paths {
            let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file);
            if let Some(version) = self.versions.get(path) {
                let differs = meta.is_some_and(|m| differs_from(version, path, &m));
                if differs {
                    self.changed.insert(path.clone());
                } else {
                    self.changed.remove(path);
                }
            } else if meta.is_some() && self.counts_as_touched(path) {
                self.touched.insert(path.clone());
            } else {
                self.touched.remove(path);
            }
        }
    }

    /// Lit `path`, le compare à sa version lue, la remplace et efface sa pastille.
    pub fn mark_read(&mut self, path: &str) -> Result<ReadOutcome> {
        let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;
        if meta.is_dir() {
            return Err(AppError::NotAFile(path.to_owned()));
        }
        let revision = revision_of(&meta);
        let text = read_text_file(Path::new(path));
        let touched = self.touched.remove(path);
        self.changed.remove(path);

        let outcome = match self.versions.get(path) {
            None => ReadOutcome::FirstRead { touched },
            Some(old) if old.revision == revision => ReadOutcome::Unchanged,
            Some(old) => match (&old.text, &text) {
                (Some(before), Some(after)) if before == after => ReadOutcome::Unchanged,
                (Some(before), Some(after)) => {
                    let (diff, added, removed) = diff::diff_texts(before, after);
                    ReadOutcome::Changed {
                        diff,
                        added,
                        removed,
                    }
                }
                _ => ReadOutcome::ChangedNoDiff,
            },
        };
        self.store(path, revision, text);
        Ok(outcome)
    }

    /// Pastilles sous `root`.
    pub fn marks(&self, root: &str) -> ReadMarks {
        let root = Path::new(root);
        let mut files = BTreeSet::new();
        let mut dirs = BTreeSet::new();
        for path in self.changed.iter().chain(&self.touched) {
            let file = Path::new(path);
            if !is_strictly_under(file, root) {
                continue;
            }
            files.insert(path.clone());
            for ancestor in file.ancestors().skip(1) {
                if !is_strictly_under(ancestor, root) {
                    break;
                }
                dirs.insert(ancestor.to_string_lossy().into_owned());
            }
        }
        ReadMarks {
            files: files.into_iter().collect(),
            dirs: dirs.into_iter().collect(),
        }
    }

    /// Un fichier jamais lu compte s'il est sous le dossier racine, hors d'une entrée masquée
    /// par défaut dans l'arborescence (règle appliquée aux seuls segments sous la racine).
    fn counts_as_touched(&self, path: &str) -> bool {
        let Some(root) = &self.root else {
            return false;
        };
        let Ok(relative) = Path::new(path).strip_prefix(root) else {
            return false;
        };
        let names: Vec<_> = relative
            .components()
            .filter_map(|c| match c {
                Component::Normal(name) => Some(name.to_string_lossy()),
                _ => None,
            })
            .collect();
        let last = names.len().saturating_sub(1);
        !names.is_empty()
            && !names
                .iter()
                .enumerate()
                .any(|(i, name)| is_hidden(name, i < last))
    }

    /// Remplace la version lue de `path`, puis oublie les textes les plus anciens au-delà du
    /// plafond (la révision reste).
    fn store(&mut self, path: &str, revision: String, text: Option<String>) {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.text_bytes += text.as_ref().map_or(0, String::len);
        let previous = self.versions.insert(
            path.to_owned(),
            ReadVersion {
                revision,
                text,
                seq,
            },
        );
        if let Some(old_text) = previous.and_then(|v| v.text) {
            self.text_bytes -= old_text.len();
        }
        while self.text_bytes > self.text_cap {
            let oldest = self
                .versions
                .values_mut()
                .filter(|v| v.text.is_some())
                .min_by_key(|v| v.seq);
            let Some(version) = oldest else { break };
            if let Some(forgotten) = version.text.take() {
                self.text_bytes -= forgotten.len();
            }
        }
    }
}

/// Le disque diffère-t-il de la version lue ? Même révision : non. Sinon, avec un texte
/// gardé, on compare les textes ; sans texte gardé, la révision suffit.
fn differs_from(version: &ReadVersion, path: &str, meta: &fs::Metadata) -> bool {
    if revision_of(meta) == version.revision {
        return false;
    }
    match &version.text {
        Some(text) => read_text_file(Path::new(path)).as_ref() != Some(text),
        None => true,
    }
}

/// `path` est sous `root` (par segments, pas par préfixe de chaîne) et n'est pas `root`.
fn is_strictly_under(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root)
        .is_ok_and(|rel| !rel.as_os_str().is_empty())
}
