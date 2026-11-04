//! Navigateur intégré (spec `navigateur.md`, décision 0011) : logique sans Tauri.

use std::fmt::Write as _;

/// Saisie du champ d'URL refusée. Sérialisée par genre (`{ reason, scheme? }`) : le front
/// traduit le message (spec `langue-interface.md`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(tag = "reason", content = "scheme", rename_all = "camelCase")]
pub enum UrlError {
    /// Champ vide (ou seulement des espaces).
    Empty,
    /// Schéma autre que `http` ou `https` (`file`, `javascript`…). Porte le schéma saisi.
    UnsupportedScheme(String),
    /// Adresse impossible à analyser au moment de la charger.
    Unreadable,
}

impl From<UrlError> for crate::AppError {
    fn from(err: UrlError) -> Self {
        Self::InvalidUrl(err)
    }
}

const SEARCH_PREFIX: &str = "https://www.google.com/search?q=";

/// Transforme la saisie du champ d'URL en URL à charger.
///
/// # Errors
///
/// `UrlError::Empty` si la saisie est vide, `UrlError::UnsupportedScheme` pour un schéma
/// autre que `http(s)`.
pub fn normalize_url(input: &str) -> Result<String, UrlError> {
    let text = input.trim();
    if text.is_empty() {
        return Err(UrlError::Empty);
    }
    if let Some(scheme) = scheme_of(text) {
        if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
            return Ok(text.to_owned());
        }
        return Err(UrlError::UnsupportedScheme(scheme.to_owned()));
    }
    let has_space = text.chars().any(char::is_whitespace);
    if !has_space && is_local_host(text) {
        return Ok(format!("http://{text}"));
    }
    if !has_space && text.contains('.') {
        return Ok(format!("https://{text}"));
    }
    Ok(format!("{SEARCH_PREFIX}{}", percent_encode(text)))
}

/// Schéma écrit au début de `text` (`javascript` dans `javascript:alert(1)`), sinon `None`.
///
/// `localhost:5173` et `example.com:8080/a` ne sont pas des schémas : ce qui suit les deux
/// points est un port. `rust: le langage` est une recherche, pas un schéma.
fn scheme_of(text: &str) -> Option<&str> {
    let (candidate, rest) = text.split_once(':')?;
    let mut chars = candidate.chars();
    if !chars.next()?.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    let port_len = rest.bytes().take_while(u8::is_ascii_digit).count();
    let after_port = rest.get(port_len..).unwrap_or("");
    let is_port =
        port_len > 0 && (after_port.is_empty() || after_port.starts_with(['/', '?', '#']));
    if is_port {
        return None;
    }
    if !candidate.contains('.') && rest.starts_with(char::is_whitespace) {
        return None;
    }
    Some(candidate)
}

/// `localhost`, `127.0.0.1` ou `[::1]`, avec port, chemin, requête ou ancre éventuels.
fn is_local_host(text: &str) -> bool {
    let end = text.find(['/', '?', '#']).unwrap_or(text.len());
    let authority = &text[..end];
    let host = if authority.starts_with('[') {
        authority.find(']').map_or(authority, |i| &authority[..=i])
    } else {
        authority.split(':').next().unwrap_or(authority)
    };
    let port = authority[host.len()..].strip_prefix(':').unwrap_or("");
    let rest_ok = authority.len() == host.len()
        || (authority[host.len()..].starts_with(':')
            && !port.is_empty()
            && port.bytes().all(|b| b.is_ascii_digit()));
    rest_ok && (host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "[::1]")
}

/// Encode les octets UTF-8 hors `A-Za-z0-9-._~` en `%XX`.
fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}
