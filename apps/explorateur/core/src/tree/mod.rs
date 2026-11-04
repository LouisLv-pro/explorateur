//! Arborescence : entrées directes d'un dossier (spec `arborescence.md`).

mod sort;

use std::fs;

use serde::Serialize;

use crate::preview::PreviewKind;
use crate::{AppError, Result};

/// Dossiers bruyants masqués par défaut (un fichier de ce nom reste visible).
const NOISY_DIRS: [&str; 3] = ["node_modules", "target", "__pycache__"];

/// Fichier ou dossier listé dans l'arborescence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Entry {
    pub name: String,
    /// Chemin absolu.
    pub path: String,
    pub is_dir: bool,
    /// `None` pour un dossier.
    pub preview_kind: Option<PreviewKind>,
}

/// Entrées directes du dossier `path`, dossiers d'abord, triées par nom.
pub fn list_directory(path: &str, show_hidden: bool) -> Result<Vec<Entry>> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory(path.to_owned()));
    }
    let reader = fs::read_dir(path).map_err(|e| AppError::from_io(&e, path))?;

    let mut entries: Vec<Entry> = reader
        // Une entrée illisible ne fait pas échouer la liste.
        .filter_map(std::result::Result::ok)
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let full = entry.path();
            // `fs::metadata` suit les liens : un lien vers un dossier est un dossier,
            // un lien cassé (métadonnées illisibles) est un fichier.
            let is_dir = fs::metadata(&full).is_ok_and(|m| m.is_dir());
            Entry {
                preview_kind: (!is_dir).then(|| PreviewKind::from_name(&name)),
                path: full.to_string_lossy().into_owned(),
                name,
                is_dir,
            }
        })
        .filter(|e| show_hidden || !is_hidden(&e.name, e.is_dir))
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| sort::compare_names(&a.name, &b.name))
    });
    Ok(entries)
}

/// Élément masqué : nom en `.`, ou dossier bruyant. Partagé avec la recherche rapide.
pub(crate) fn is_hidden(name: &str, is_dir: bool) -> bool {
    name.starts_with('.') || (is_dir && NOISY_DIRS.contains(&name))
}
