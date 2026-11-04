//! Lecture d'un lien `explorateur://open?path=…&line=…&column=…` (spec
//! `ouvrir-depuis-terminal.md`, décision 0013). Le lien ne fait qu'ouvrir : seuls `path`,
//! `line` et `column` sont lus, le chemin est ensuite normalisé par `resolve_open`.

use std::path::Path;

use percent_encoding::percent_decode_str;

use super::open::OpenRequest;

/// Demande d'ouverture lue dans `url`, ou `None` si le lien n'est pas un `explorateur://open`
/// valide (autre schéma ou hôte, requête absente, `path` absent ou relatif, UTF-8 invalide).
pub fn parse_open_link(url: &str) -> Option<OpenRequest> {
    // Le fragment (`#…`) ne compte pas.
    let url = url.split_once('#').map_or(url, |(before, _)| before);
    let (scheme, rest) = url.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("explorateur") {
        return None;
    }
    let (host, query) = rest.split_once('?')?;
    if !host.eq_ignore_ascii_case("open") && !host.eq_ignore_ascii_case("open/") {
        return None;
    }

    let mut path = None;
    let mut line = None;
    let mut column = None;
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        // `percent_decode_str` laisse `+` tel quel : pas d'espace à la place.
        let key = percent_decode_str(key).decode_utf8().ok()?;
        let value = percent_decode_str(value).decode_utf8().ok()?;
        match key.as_ref() {
            "path" if path.is_none() => path = Some(value.into_owned()),
            "line" if line.is_none() => line = Some(value.into_owned()),
            "column" if column.is_none() => column = Some(value.into_owned()),
            _ => {}
        }
    }

    let mut path = path?;
    if !path.starts_with('/') {
        return None;
    }
    let mut line = line.as_deref().and_then(positive);
    // Une colonne n'a de sens qu'avec une ligne.
    let mut column = line.and(column.as_deref().and_then(positive));

    // Suffixe `:ligne` ou `:ligne:colonne` (CLI) : seulement si le chemin littéral n'existe pas.
    if line.is_none()
        && !Path::new(&path).exists()
        && let Some((stripped, l, c)) = split_suffix(&path)
    {
        path = stripped;
        line = Some(l);
        column = c;
    }

    Some(OpenRequest {
        path,
        line,
        column,
        link: true,
    })
}

/// Entier ≥ 1 écrit en chiffres seuls, sinon `None`.
fn positive(value: &str) -> Option<u32> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|n| *n >= 1)
}

/// `chemin:N` ou `chemin:N:M` → (`chemin`, N, M). `None` si la fin n'est pas un tel suffixe.
fn split_suffix(path: &str) -> Option<(String, u32, Option<u32>)> {
    let (head, last) = path.rsplit_once(':')?;
    let last_num = positive(last)?;
    if let Some((base, mid)) = head.rsplit_once(':')
        && let Some(line) = positive(mid)
    {
        return Some((base.to_owned(), line, Some(last_num)));
    }
    Some((head.to_owned(), last_num, None))
}
