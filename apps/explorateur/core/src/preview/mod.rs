//! Aperçu d'un fichier : type d'aperçu (partagé avec l'arborescence) et lecture du contenu.

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use serde::Serialize;

use crate::{AppError, Result};

mod resource;

pub use resource::{Resource, read_resource};

/// Taille maximale d'un fichier texte lu pour l'aperçu : 2 Mio (inclus). Les compteurs des
/// fichiers non suivis du statut git s'arrêtent au même seuil.
pub(crate) const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
/// Taille maximale d'un notebook (`.ipynb`) lu pour l'aperçu : 20 Mio (inclus). Plus haute que
/// celle du texte car les images des sorties y sont en base64 (décision 0024).
pub const MAX_NOTEBOOK_BYTES: u64 = 20 * 1024 * 1024;
/// Nombre d'octets examinés pour détecter un fichier binaire (octet nul).
const BINARY_WINDOW: usize = 8 * 1024;
const UTF8_BOM: &str = "\u{feff}";

/// Contenu d'aperçu d'un fichier. Image et PDF sont lus par le front (protocole `asset`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind")]
pub enum PreviewContent {
    Markdown {
        text: String,
    },
    Html {
        text: String,
    },
    /// Source Mermaid (`.mmd`, `.mermaid`) : le front la dessine.
    Mermaid {
        text: String,
    },
    Text {
        text: String,
    },
    /// Notebook Jupyter (`.ipynb`, 20 Mio au plus) : le JSON tel quel, analysé par le front.
    Notebook {
        text: String,
    },
    Image,
    Pdf,
    /// Page HTML de plus de 2 Mio : non lue, l'`iframe` la charge par le protocole `preview`
    /// mais la source n'est pas disponible.
    LargeHtml,
    /// Texte de plus de 2 Mio (notebook de plus de 20 Mio) : non lu.
    TooLarge,
    /// Octet nul dans les premiers Kio, ou UTF-8 invalide.
    Binary,
}

/// Fichier ouvert pour l'aperçu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FilePreview {
    pub path: String,
    pub name: String,
    /// Taille en octets. Specta refuse `u64` : on l'exporte comme `number` (`i32` donne ce type
    /// sans `| null`). Sérialisé tel quel en JSON, donc exact jusqu'à 2^53.
    #[specta(type = i32)]
    pub size: u64,
    pub content: PreviewContent,
    /// Révision du fichier lu (date de modification en nanosecondes et taille), chaîne opaque
    /// pour le front : `save_file` la compare à celle du disque (décision 0003).
    pub revision: String,
}

/// Révision d'un fichier d'après ses métadonnées : `<secondes>.<nanosecondes>-<taille>`.
pub(crate) fn revision_of(meta: &fs::Metadata) -> String {
    format!("{}.{:09}-{}", meta.mtime(), meta.mtime_nsec(), meta.size())
}

/// Lit le fichier `path` pour l'afficher.
pub fn open_file(path: &str) -> Result<FilePreview> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile(path.to_owned()));
    }
    let name = Path::new(path)
        .file_name()
        .map_or_else(|| path.to_owned(), |n| n.to_string_lossy().into_owned());
    let size = meta.len();

    let kind = PreviewKind::from_name(&name);
    let content = match kind {
        PreviewKind::Image => PreviewContent::Image,
        PreviewKind::Pdf => PreviewContent::Pdf,
        PreviewKind::Html if size > MAX_TEXT_BYTES => PreviewContent::LargeHtml,
        // Ce bras passe avant celui des textes : un notebook a sa propre limite.
        PreviewKind::Notebook if size > MAX_NOTEBOOK_BYTES => PreviewContent::TooLarge,
        PreviewKind::Notebook => read_text(path, &kind)?,
        _ if size > MAX_TEXT_BYTES => PreviewContent::TooLarge,
        _ => read_text(path, &kind)?,
    };
    Ok(FilePreview {
        path: path.to_owned(),
        name,
        size,
        content,
        revision: revision_of(&meta),
    })
}

/// Lit un fichier texte ; `Binary` s'il n'en est pas un.
fn read_text(path: &str, kind: &PreviewKind) -> Result<PreviewContent> {
    let bytes = fs::read(path).map_err(|e| AppError::from_io(&e, path))?;
    let Some(text) = decode_text(bytes) else {
        return Ok(PreviewContent::Binary);
    };
    Ok(match kind {
        PreviewKind::Markdown => PreviewContent::Markdown { text },
        PreviewKind::Html => PreviewContent::Html { text },
        PreviewKind::Mermaid => PreviewContent::Mermaid { text },
        PreviewKind::Notebook => PreviewContent::Notebook { text },
        _ => PreviewContent::Text { text },
    })
}

/// Texte d'un fichier que l'aperçu afficherait en texte (Markdown, HTML, texte de 2 Mio au
/// plus, non binaire), BOM retiré. `None` sinon, ou s'il est illisible.
pub(crate) fn read_text_file(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy();
    if matches!(
        PreviewKind::from_name(&name),
        PreviewKind::Image | PreviewKind::Pdf
    ) {
        return None;
    }
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_TEXT_BYTES {
        return None;
    }
    decode_text(fs::read(path).ok()?)
}

/// Octets → texte, BOM retiré ; `None` si binaire (octet nul dans les premiers Kio, UTF-8
/// invalide).
fn decode_text(bytes: Vec<u8>) -> Option<String> {
    let window = &bytes[..bytes.len().min(BINARY_WINDOW)];
    if window.contains(&0) {
        return None;
    }
    let mut text = String::from_utf8(bytes).ok()?;
    if text.starts_with(UTF8_BOM) {
        text.drain(..UTF8_BOM.len());
    }
    Some(text)
}

/// Type d'aperçu d'un fichier, déduit de son extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Markdown,
    Html,
    Mermaid,
    Image,
    Pdf,
    /// Notebook Jupyter (`.ipynb`).
    Notebook,
    Text,
}

impl PreviewKind {
    /// Type d'aperçu d'après la dernière extension du nom, sans tenir compte de la casse.
    pub fn from_name(name: &str) -> Self {
        let ext = Path::new(name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "md" | "markdown" => Self::Markdown,
            "html" | "htm" => Self::Html,
            "mmd" | "mermaid" => Self::Mermaid,
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => Self::Image,
            "pdf" => Self::Pdf,
            "ipynb" => Self::Notebook,
            _ => Self::Text,
        }
    }
}
