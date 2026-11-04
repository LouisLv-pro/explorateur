//! Actions sur un fichier ou un dossier du disque : Finder, création, renommage, corbeille,
//! enregistrement (écriture : décision 0003).

use std::fs::{self, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use crate::preview::revision_of;
use crate::{AppError, Result};

/// Vérifie que `path` existe (fichier ou dossier). `NotFound` sinon.
///
/// `try_exists` distingue « absent » (`Ok(false)`) d'une erreur d'accès (`Err`), traduite
/// comme ailleurs par `AppError::from_io`.
pub fn ensure_exists(path: &str) -> Result<()> {
    match Path::new(path).try_exists() {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::NotFound(path.to_owned())),
        Err(err) => Err(AppError::from_io(&err, path)),
    }
}

/// Valide un nom de fichier ou de dossier et le renvoie sans espaces autour.
///
/// `InvalidName` si le nom est vide, vaut `.` ou `..`, contient `/` ou un caractère nul.
pub fn validate_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." || trimmed.contains(['/', '\0']) {
        return Err(AppError::InvalidName(name.to_owned()));
    }
    Ok(trimmed.to_owned())
}

/// Vérifie que `dir` est un dossier : `NotFound` s'il est absent, `NotADirectory` sinon.
fn ensure_dir(dir: &str) -> Result<()> {
    let meta = fs::metadata(dir).map_err(|err| AppError::from_io(&err, dir))?;
    if meta.is_dir() {
        Ok(())
    } else {
        Err(AppError::NotADirectory(dir.to_owned()))
    }
}

/// Traduit une erreur de création : `AlreadyExists` porte le chemin créé.
fn creation_error(err: &io::Error, path: &str) -> AppError {
    if err.kind() == io::ErrorKind::AlreadyExists {
        AppError::AlreadyExists(path.to_owned())
    } else {
        AppError::from_io(err, path)
    }
}

/// Crée un fichier vide `dir/name` et renvoie son chemin absolu.
///
/// `create_new` refuse une entrée existante sans toucher à son contenu (`AlreadyExists`).
pub fn create_file(dir: &str, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    ensure_dir(dir)?;
    let path = Path::new(dir).join(&name);
    let shown = path.to_string_lossy().into_owned();
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|err| creation_error(&err, &shown))?;
    Ok(shown)
}

/// Crée un dossier vide `dir/name` et renvoie son chemin absolu.
///
/// `fs::create_dir` refuse une entrée existante, fichier ou dossier (`AlreadyExists`).
pub fn create_dir(dir: &str, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    ensure_dir(dir)?;
    let path = Path::new(dir).join(&name);
    let shown = path.to_string_lossy().into_owned();
    fs::create_dir(&path).map_err(|err| creation_error(&err, &shown))?;
    Ok(shown)
}

/// Renomme `path` dans son dossier et renvoie le nouveau chemin absolu.
///
/// Même nom : rien ne change. Une autre entrée du même nom : `AlreadyExists` (`fs::rename`
/// l'écraserait en silence sur macOS). Un changement de casse seul est accepté : sur APFS la
/// cible « existe » mais c'est la même entrée (même volume et même inode).
pub fn rename_entry(path: &str, new_name: &str) -> Result<String> {
    let name = validate_name(new_name)?;
    let source = Path::new(path);
    let source_meta = fs::symlink_metadata(source).map_err(|err| AppError::from_io(&err, path))?;
    if source
        .file_name()
        .is_some_and(|current| current == name.as_str())
    {
        return Ok(path.to_owned());
    }
    let parent = source
        .parent()
        .ok_or_else(|| AppError::InvalidName(path.to_owned()))?;
    let target = parent.join(&name);
    let shown = target.to_string_lossy().into_owned();

    match fs::symlink_metadata(&target) {
        Ok(target_meta) => {
            let same_entry = target_meta.dev() == source_meta.dev()
                && target_meta.ino() == source_meta.ino()
                && source.file_name().is_some_and(|current| {
                    current.to_string_lossy().to_lowercase() == name.to_lowercase()
                });
            if !same_entry {
                return Err(AppError::AlreadyExists(shown));
            }
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(AppError::from_io(&err, &shown)),
    }
    fs::rename(source, &target).map_err(|err| AppError::from_io(&err, path))?;
    Ok(shown)
}

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Enregistre `text` dans `path`, sur place, et renvoie la nouvelle révision (décision 0003).
///
/// `Conflict` si la révision du disque n'est plus `revision` (rien n'est écrit). Fichier
/// absent mais dossier parent présent : recréé, sans contrôle de révision ; parent absent :
/// `NotFound`. Le BOM UTF-8 d'origine est remis devant `text`.
pub fn save_file(path: &str, text: &str, revision: &str) -> Result<String> {
    let had_bom = match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => return Err(AppError::NotAFile(path.to_owned())),
        Ok(meta) => {
            if revision_of(&meta) != revision {
                return Err(AppError::Conflict(path.to_owned()));
            }
            starts_with_bom(path)?
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            let parent_is_dir = Path::new(path)
                .parent()
                .is_some_and(|parent| parent.is_dir());
            if !parent_is_dir {
                return Err(AppError::NotFound(path.to_owned()));
            }
            false
        }
        Err(err) => return Err(AppError::from_io(&err, path)),
    };

    let bytes = if had_bom {
        [UTF8_BOM, text.as_bytes()].concat()
    } else {
        text.as_bytes().to_vec()
    };
    fs::write(path, bytes).map_err(|err| AppError::from_io(&err, path))?;
    let meta = fs::metadata(path).map_err(|err| AppError::from_io(&err, path))?;
    Ok(revision_of(&meta))
}

/// Vrai si le fichier `path` commence par un BOM UTF-8.
fn starts_with_bom(path: &str) -> Result<bool> {
    let mut head = Vec::with_capacity(UTF8_BOM.len());
    fs::File::open(path)
        .and_then(|file| file.take(UTF8_BOM.len() as u64).read_to_end(&mut head))
        .map_err(|err| AppError::from_io(&err, path))?;
    Ok(head == UTF8_BOM)
}

/// Met `path` à la corbeille de macOS. Jamais de suppression définitive : si la corbeille
/// échoue, l'entrée reste et l'erreur est `Io`.
pub fn move_to_trash(path: &str) -> Result<()> {
    ensure_exists(path)?;
    trash::delete(path).map_err(|err| AppError::Io(format!("{path}: {err}")))
}
