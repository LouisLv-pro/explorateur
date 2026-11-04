//! Dossier racine et dossiers récents (spec `dossier-racine.md`).

mod link;
mod open;
mod repo;

pub use link::parse_open_link;
pub use open::{OpenRequest, OpenTarget, resolve_open, resolve_requests};

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::db::Db;
use crate::{AppError, Result};

/// Nombre de dossiers récents gardés en base.
pub const MAX_RECENTS: i64 = 10;

/// Dossier ouvert dans l'explorateur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RootFolder {
    /// Chemin absolu normalisé.
    pub path: String,
    /// Dernier segment du chemin, `/` pour la racine du disque.
    pub name: String,
}

/// Dossier racine déjà ouvert.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct RecentFolder {
    pub path: String,
    pub name: String,
    /// `false` si le dossier a disparu du disque depuis.
    pub exists: bool,
}

/// Ouvre `path` comme dossier racine et le place en tête des récents.
pub async fn open_root(db: &Db, path: &str) -> Result<RootFolder> {
    let root = resolve_root(path)?;
    repo::touch(db, &root.path, MAX_RECENTS).await?;
    Ok(root)
}

/// Dossiers récents, du plus récent au plus ancien.
pub async fn list_recent_folders(db: &Db) -> Result<Vec<RecentFolder>> {
    let paths = repo::list(db, MAX_RECENTS).await?;
    Ok(paths
        .into_iter()
        .map(|path| RecentFolder {
            name: name_of(&path),
            exists: Path::new(&path).is_dir(),
            path,
        })
        .collect())
}

/// Retire `path` des récents. Sans effet s'il n'y est pas.
pub async fn remove_recent_folder(db: &Db, path: &str) -> Result<()> {
    repo::remove(db, path).await
}

/// Le dossier récent le plus récent qui existe encore.
pub async fn last_root(db: &Db) -> Result<Option<RootFolder>> {
    Ok(list_recent_folders(db)
        .await?
        .into_iter()
        .find(|r| r.exists)
        .map(|r| RootFolder {
            path: r.path,
            name: r.name,
        }))
}

/// Vérifie que `path` est un dossier absolu lisible et le normalise.
fn resolve_root(path: &str) -> Result<RootFolder> {
    // Un chemin relatif dépendrait du dossier courant du processus : refusé.
    if !Path::new(path).is_absolute() {
        return Err(AppError::NotFound(path.to_owned()));
    }
    let canonical = fs::canonicalize(path).map_err(|e| AppError::from_io(&e, path))?;
    let meta = fs::metadata(&canonical).map_err(|e| AppError::from_io(&e, path))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory(path.to_owned()));
    }
    // `canonicalize` réussit sur un dossier illisible : il faut essayer de le lire.
    fs::read_dir(&canonical).map_err(|e| AppError::from_io(&e, path))?;
    let path = canonical.to_string_lossy().into_owned();
    Ok(RootFolder {
        name: name_of(&path),
        path,
    })
}

/// Dernier segment d'un chemin, `/` pour la racine du disque.
fn name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map_or_else(|| "/".to_owned(), |n| n.to_string_lossy().into_owned())
}
