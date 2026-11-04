//! Protocole `preview` : sert une page HTML prévisualisée et ses ressources relatives, sans
//! cache, pour que « Recharger » relise aussi le CSS et les scripts (décision 0001).
//! URL : `preview://localhost/Users/…/index.html`, un segment par dossier.

use explorateur_core::{AppError, preview};
use tauri::http::{Request, Response, StatusCode, header};

/// Nom du protocole, repris par le front (`convertFileSrc("", "preview")`) et la CSP.
pub const SCHEME: &str = "preview";

/// Réponse à une requête du protocole : le fichier dont le chemin est celui de l'URL.
pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_encoding::percent_decode_str(request.uri().path()).decode_utf8_lossy();
    match preview::read_resource(&path) {
        Ok(resource) => Response::builder()
            .header(header::CONTENT_TYPE, resource.mime)
            .header(header::CACHE_CONTROL, "no-store")
            .body(resource.bytes),
        Err(err) => {
            let status = match err {
                AppError::PermissionDenied(_) => StatusCode::FORBIDDEN,
                AppError::NotFound(_) | AppError::NotAFile(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(err.to_string().into_bytes())
        }
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}
