//! Apps Swift (spec `apps-commandes.md`, décision 0023) : une app par exécutable d'un
//! `Package.swift`, lancée par `swift run`. Le manifeste est lu comme du texte, jamais par
//! `swift package dump-package` (il compile le manifeste). Seuls les littéraux de chaîne sont lus.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use super::{AppKind, NativeApp, cap_per_package, command_app};
use crate::terminal::shell_quote;

/// Apps du `Package.swift` de `dir` (rien s'il est illisible).
pub(super) fn swift_apps(dir: &Path, relative_dir: &str) -> Vec<NativeApp> {
    let Ok(source) = fs::read_to_string(dir.join("Package.swift")) else {
        return Vec::new();
    };
    cap_per_package(executables(&source), |name| (0, name.clone()))
        .into_iter()
        .map(|product| {
            command_app(
                &product,
                dir,
                relative_dir,
                (&format!("product:{product}"), "swift run", AppKind::Swift),
                format!("swift run {}", shell_quote(&product)),
            )
        })
        .collect()
}

/// Exécutables du manifeste : chaque `.executable(name:)`, et chaque `.executableTarget(name:)`
/// qu'aucun `.executable(targets:)` ne couvre (SwiftPM crée alors un produit du même nom).
/// Triés par nom, sans les exécutables de tests ou de benchmarks.
fn executables(source: &str) -> Vec<String> {
    let text = strip_comments(source);
    let mut products = BTreeSet::new();
    let mut covered = BTreeSet::new();
    for body in call_bodies(&text, ".executable(") {
        let args = labelled(body);
        if let Some(name) = args.get("name").copied().and_then(string_literal) {
            products.insert(name);
        }
        if let Some(list) = args.get("targets") {
            covered.extend(string_list(list));
        }
    }
    for body in call_bodies(&text, ".executableTarget(") {
        if let Some(name) = labelled(body).get("name").copied().and_then(string_literal)
            && !covered.contains(&name)
        {
            products.insert(name);
        }
    }
    products
        .into_iter()
        .filter(|name| {
            !(name.ends_with("Tests")
                || name.ends_with("Benchmark")
                || name.ends_with("Benchmarks"))
        })
        .collect()
}

/// `text` sans les commentaires `//` et `/* */` (imbriqués), hors des chaînes (une URL de
/// dépendance contient `//`). Un commentaire de bloc devient une espace, un de ligne garde
/// son saut de ligne.
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let (mut in_string, mut escaped) = (false, false);
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            out.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            for rest in chars.by_ref() {
                if rest == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut depth = 1;
            while let Some(rest) = chars.next() {
                if rest == '/' && chars.peek() == Some(&'*') {
                    chars.next();
                    depth += 1;
                } else if rest == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
            }
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

/// Contenus entre parenthèses de chaque appel `opening` (par exemple `.executable(`).
fn call_bodies<'a>(text: &'a str, opening: &str) -> Vec<&'a str> {
    text.match_indices(opening)
        .filter_map(|(start, _)| {
            let body = &text[start + opening.len()..];
            let (mut depth, mut in_string, mut escaped) = (1usize, false, false);
            for (i, c) in body.char_indices() {
                if in_string {
                    if escaped {
                        escaped = false;
                    } else if c == '\\' {
                        escaped = true;
                    } else if c == '"' {
                        in_string = false;
                    }
                    continue;
                }
                match c {
                    '"' => in_string = true,
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(&body[..i]);
                        }
                    }
                    _ => {}
                }
            }
            None
        })
        .collect()
}

/// Arguments étiquetés d'un appel (`name: "X", targets: ["X"]`), étiquette vers valeur.
fn labelled(body: &str) -> BTreeMap<&str, &str> {
    split_top(body)
        .into_iter()
        .filter_map(|arg| {
            let (label, value) = arg.split_once(':')?;
            let label = label.trim();
            let is_label =
                !label.is_empty() && label.chars().all(|c| c.is_alphanumeric() || c == '_');
            is_label.then_some((label, value.trim()))
        })
        .collect()
}

/// Découpe `text` aux virgules qui ne sont ni dans une chaîne ni dans des (), [] ou {}.
fn split_top(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut in_string, mut escaped, mut start) = (0usize, false, false, 0);
    for (i, c) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&text[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
}

/// Contenu d'un littéral de chaîne simple (`"X"`). `None` pour tout autre texte (variable,
/// interpolation, concaténation).
fn string_literal(value: &str) -> Option<String> {
    let inner = value.trim().strip_prefix('"')?.strip_suffix('"')?;
    (!inner.contains(['"', '\\'])).then(|| inner.to_owned())
}

/// Littéraux de chaîne d'une liste `["A", "B"]` ; les autres éléments sont ignorés.
fn string_list(value: &str) -> Vec<String> {
    let Some(inner) = value
        .trim()
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    else {
        return Vec::new();
    };
    split_top(inner)
        .into_iter()
        .filter_map(string_literal)
        .collect()
}
