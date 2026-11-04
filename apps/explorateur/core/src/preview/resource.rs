//! Ressources d'une page HTML prévisualisée (la page, son CSS, ses scripts, ses images),
//! servies telles quelles par le protocole `preview` de l'app (décision 0001).

use std::fs;
use std::path::Path;

use crate::{AppError, Result};

/// Fichier servi par le protocole `preview` : ses octets et son type MIME.
#[derive(Debug)]
pub struct Resource {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

/// Lit le fichier `path` tel quel, sans limite de taille ni décodage.
pub fn read_resource(path: &str) -> Result<Resource> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile(path.to_owned()));
    }
    let bytes = fs::read(path).map_err(|e| AppError::from_io(&e, path))?;
    Ok(Resource {
        bytes,
        mime: mime_for(path),
    })
}

/// Type MIME d'après l'extension, sans tenir compte de la casse.
fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}
