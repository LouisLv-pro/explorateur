//! Modèles d'issue Markdown (`.github/ISSUE_TEMPLATE/*.md`) : lecture sur le disque et
//! analyse de leur en-tête YAML, écrite à la main (le sous-ensemble utilisé par GitHub).

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::git::{self, Git};

/// Dossier des modèles, relatif à la racine du dépôt git.
const TEMPLATES_DIR: &str = ".github/ISSUE_TEMPLATE";

/// Un modèle d'issue : choix du dialogue de création (nom, description) et valeurs de départ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IssueTemplate {
    pub file_name: String,
    pub name: String,
    pub description: String,
    pub title: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub body: String,
}

/// Valeur d'une clé de l'en-tête : texte brut après `clé:`, ou éléments de lignes `- a`.
enum Value {
    Raw(String),
    Items(Vec<String>),
}

/// Retire une paire de guillemets simples ou doubles autour d'un scalaire.
fn unquote(text: &str) -> String {
    let text = text.trim();
    for quote in ['"', '\''] {
        if text.len() >= 2 && text.starts_with(quote) && text.ends_with(quote) {
            let inner = &text[1..text.len() - 1];
            // YAML double l'apostrophe dans un scalaire entre guillemets simples.
            return if quote == '\'' {
                inner.replace("''", "'")
            } else {
                inner.to_owned()
            };
        }
    }
    text.to_owned()
}

/// Liste de valeurs rognées, sans valeur vide, séparée par des virgules.
fn split_commas(text: &str) -> Vec<String> {
    text.split(',')
        .map(unquote)
        .filter(|s| !s.is_empty())
        .collect()
}

impl Value {
    fn scalar(&self) -> String {
        match self {
            Self::Raw(raw) => unquote(raw),
            Self::Items(items) => items.join(", "),
        }
    }

    /// Liste `[a, b]`, lignes `- a`, ou chaîne séparée par des virgules.
    fn list(&self) -> Vec<String> {
        match self {
            Self::Items(items) => items
                .iter()
                .map(|s| unquote(s))
                .filter(|s| !s.is_empty())
                .collect(),
            Self::Raw(raw) => {
                let raw = raw.trim();
                match raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    Some(inner) => split_commas(inner),
                    None => split_commas(&unquote(raw)),
                }
            }
        }
    }
}

/// Clé d'en-tête : lettres, chiffres, `_` et `-`.
fn is_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
}

/// Lit l'en-tête : `None` si une ligne n'est ni `clé: valeur` ni élément de liste.
fn parse_header(lines: &[&str]) -> Option<Vec<(String, Value)>> {
    let mut entries: Vec<(String, Value)> = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed == "-" || trimmed.starts_with("- ") {
            let item = trimmed.trim_start_matches('-').trim().to_owned();
            // Un élément de liste appartient à la dernière clé.
            let (_, value) = entries.last_mut()?;
            match value {
                Value::Items(items) => items.push(item),
                Value::Raw(raw) if raw.trim().is_empty() => *value = Value::Items(vec![item]),
                Value::Raw(_) => return None,
            }
            continue;
        }
        let (key, value) = trimmed.split_once(':')?;
        let key = key.trim();
        if !is_key(key) {
            return None;
        }
        entries.retain(|(k, _)| k != key);
        entries.push((key.to_owned(), Value::Raw(value.trim().to_owned())));
    }
    Some(entries)
}

/// Modèle d'issue d'un fichier `.md` : en-tête YAML entre deux lignes `---`, puis le corps.
/// `None` sans en-tête, en-tête non fermé ou illisible, ou sans `name`.
pub fn parse_issue_template(file_name: &str, text: &str) -> Option<IssueTemplate> {
    let mut lines = text.split_inclusive('\n');
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut header = Vec::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line.trim_end() == "---" {
            closed = true;
            break;
        }
        header.push(line.trim_end_matches(['\n', '\r']));
    }
    if !closed {
        return None;
    }
    let entries = parse_header(&header)?;
    let get = |key: &str| entries.iter().find(|(k, _)| k == key).map(|(_, v)| v);
    let name = get("name").map(Value::scalar).filter(|n| !n.is_empty())?;
    // Reste du texte : lignes vides du début retirées.
    let body: String = lines.skip_while(|l| l.trim().is_empty()).collect();
    Some(IssueTemplate {
        file_name: file_name.to_owned(),
        name,
        description: get("about").map(Value::scalar).unwrap_or_default(),
        title: get("title").map(Value::scalar).unwrap_or_default(),
        labels: get("labels").map(Value::list).unwrap_or_default(),
        assignees: get("assignees").map(Value::list).unwrap_or_default(),
        body,
    })
}

/// Modèles `*.md` de `.github/ISSUE_TEMPLATE/` à la racine du dépôt git qui contient `root`,
/// triés par nom de fichier. Ce qui n'est pas un modèle lisible est ignoré ; jamais d'erreur.
pub fn list_issue_templates(git: &Git, root: &Path) -> Vec<IssueTemplate> {
    let Some(top) = git::repo_top(git, root) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(top.join(TEMPLATES_DIR)) else {
        return Vec::new();
    };
    let mut templates: Vec<IssueTemplate> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let is_markdown = path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
            if !is_markdown || !fs::metadata(&path).is_ok_and(|m| m.is_file()) {
                return None;
            }
            parse_issue_template(&file_name, &fs::read_to_string(&path).ok()?)
        })
        .collect();
    templates.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    templates
}
