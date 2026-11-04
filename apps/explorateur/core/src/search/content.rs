//! Recherche dans le contenu des fichiers (spec `recherche-contenu.md`).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{files_of, relative_with_slashes, walk};
use crate::git::Git;
use crate::preview::read_text_file;
use crate::{AppError, Result};

/// Nombre maximal d'occurrences rendues, puis le parcours s'arrête.
const MAX_OCCURRENCES: usize = 2_000;
/// Longueur minimale de la requête, en caractères (espaces compris).
const MIN_QUERY_CHARS: usize = 2;
/// Au-delà de cette longueur (en caractères), une ligne est réduite à un extrait.
const LONG_LINE: usize = 250;
/// L'extrait commence ce nombre de caractères avant la première occurrence…
const EXCERPT_BEFORE: usize = 40;
/// … et s'arrête ce nombre de caractères après son début.
const EXCERPT_AFTER: usize = 200;
const ELLIPSIS: char = '…';

/// Résultat d'une recherche dans le contenu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ContentSearch {
    /// Fichiers avec au moins une occurrence, par `relative_path`.
    pub files: Vec<FileHits>,
    /// Nombre d'occurrences rendues.
    pub total: u32,
    /// Vrai si la limite de 2 000 occurrences a arrêté la recherche.
    pub truncated: bool,
}

/// Occurrences d'un fichier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct FileHits {
    /// Chemin absolu.
    pub path: String,
    /// Chemin relatif à la racine, séparé par `/`.
    pub relative_path: String,
    /// Lignes trouvées, dans l'ordre du fichier.
    pub hits: Vec<Hit>,
}

/// Ligne contenant au moins une occurrence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct Hit {
    /// Numéro de ligne, à partir de 1.
    pub line: u32,
    /// Texte de la ligne sans fin de ligne, ou extrait encadré de `…` si elle est longue.
    pub text: String,
    /// Occurrences `[début, fin)`, en caractères dans `text`.
    pub ranges: Vec<(u32, u32)>,
}

/// Lignes des fichiers texte de `root` contenant `query` (texte littéral), 2 000 occurrences
/// au plus. Requête de moins de 2 caractères : résultat vide, sans parcours.
pub fn search_content(
    root: &str,
    query: &str,
    case_sensitive: bool,
    show_hidden: bool,
) -> Result<ContentSearch> {
    search_in(root, query, case_sensitive, |root_path| {
        walk(root_path, show_hidden)
    })
}

/// Comme `search_content`, mais dans un dépôt git les fichiers ignorés par git sont traités
/// comme des éléments masqués (absents sauf `show_hidden`). Hors dépôt ou git absent :
/// `search_content`.
pub fn search_content_git(
    git: &Git,
    root: &str,
    query: &str,
    case_sensitive: bool,
    show_hidden: bool,
) -> Result<ContentSearch> {
    search_in(root, query, case_sensitive, |root_path| {
        files_of(git, root_path, show_hidden)
    })
}

fn search_in(
    root: &str,
    query: &str,
    case_sensitive: bool,
    list_files: impl FnOnce(&Path) -> Vec<PathBuf>,
) -> Result<ContentSearch> {
    let mut result = ContentSearch {
        files: Vec::new(),
        total: 0,
        truncated: false,
    };
    if query.chars().count() < MIN_QUERY_CHARS {
        return Ok(result);
    }
    let meta = fs::metadata(root).map_err(|e| AppError::from_io(&e, root))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory(root.to_owned()));
    }

    let matcher = Matcher::new(query, case_sensitive);
    let root_path = Path::new(root);
    let mut files: Vec<(String, PathBuf)> = list_files(root_path)
        .into_iter()
        .map(|file| (relative_with_slashes(root_path, &file), file))
        .collect();
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let mut total = 0_usize;
    'files: for (relative_path, file) in files {
        let Some(text) = read_text_file(&file) else {
            continue;
        };
        if !matcher.may_contain(&text) {
            continue;
        }
        let mut hits = Vec::new();
        for (index, raw) in text.split('\n').enumerate() {
            let line = raw.strip_suffix('\r').unwrap_or(raw);
            let Some(mut hit) = matcher.hit(line, index) else {
                continue;
            };
            let left = MAX_OCCURRENCES - total;
            if left == 0 {
                result.truncated = true;
                push_file(&mut result, &file, relative_path, hits);
                break 'files;
            }
            if hit.ranges.len() > left {
                hit.ranges.truncate(left);
                result.truncated = true;
            }
            total += hit.ranges.len();
            hits.push(hit);
            if result.truncated {
                push_file(&mut result, &file, relative_path, hits);
                break 'files;
            }
        }
        push_file(&mut result, &file, relative_path, hits);
    }
    result.total = u32::try_from(total).unwrap_or(u32::MAX);
    Ok(result)
}

/// Ajoute le fichier au résultat s'il a des occurrences.
fn push_file(result: &mut ContentSearch, file: &Path, relative_path: String, hits: Vec<Hit>) {
    if !hits.is_empty() {
        result.files.push(FileHits {
            path: file.to_string_lossy().into_owned(),
            relative_path,
            hits,
        });
    }
}

/// Correspondance littérale, avec ou sans casse, comptée en caractères.
struct Matcher {
    case_sensitive: bool,
    /// Requête telle quelle (avec casse) ou en minuscules (sans casse), pour le filtre rapide.
    needle: String,
    /// Requête caractère par caractère, repliée si sans casse.
    chars: Vec<char>,
}

impl Matcher {
    fn new(query: &str, case_sensitive: bool) -> Self {
        let needle = if case_sensitive {
            query.to_owned()
        } else {
            query.to_lowercase()
        };
        let chars = query.chars().map(|c| fold(c, case_sensitive)).collect();
        Self {
            case_sensitive,
            needle,
            chars,
        }
    }

    /// Filtre rapide : faux si `text` ne peut pas contenir la requête.
    fn may_contain(&self, text: &str) -> bool {
        if self.case_sensitive {
            text.contains(&self.needle)
        } else {
            text.to_lowercase().contains(&self.needle)
        }
    }

    /// `Hit` de la ligne `index` (à partir de 0) si elle contient la requête.
    fn hit(&self, line: &str, index: usize) -> Option<Hit> {
        if !self.may_contain(line) {
            return None;
        }
        let chars: Vec<char> = line.chars().collect();
        let n = self.chars.len();
        let mut ranges = Vec::new();
        let mut i = 0;
        while i + n <= chars.len() {
            let found = chars[i..i + n]
                .iter()
                .zip(&self.chars)
                .all(|(c, q)| fold(*c, self.case_sensitive) == *q);
            if found {
                ranges.push((i, i + n));
                i += n;
            } else {
                i += 1;
            }
        }
        let first = ranges.first()?.0;
        let (text, ranges) = if chars.len() > LONG_LINE {
            excerpt(&chars, &ranges, first)
        } else {
            (line.to_owned(), ranges)
        };
        Some(Hit {
            line: to_u32(index + 1),
            text,
            ranges: ranges
                .into_iter()
                .map(|(a, b)| (to_u32(a), to_u32(b)))
                .collect(),
        })
    }
}

/// Extrait d'une ligne longue autour de la première occurrence, `ranges` décalées et
/// celles qui en sortent retirées.
fn excerpt(
    chars: &[char],
    ranges: &[(usize, usize)],
    first: usize,
) -> (String, Vec<(usize, usize)>) {
    let start = first.saturating_sub(EXCERPT_BEFORE);
    let end = (first + EXCERPT_AFTER).min(chars.len());
    let mut text = String::new();
    // Le `…` initial compte dans le décalage des `ranges`.
    let shift_back = if start > 0 {
        text.push(ELLIPSIS);
        1
    } else {
        0
    };
    text.extend(&chars[start..end]);
    if end < chars.len() {
        text.push(ELLIPSIS);
    }
    let ranges = ranges
        .iter()
        .filter(|(a, b)| *a >= start && *b <= end)
        .map(|(a, b)| (a - start + shift_back, b - start + shift_back))
        .collect();
    (text, ranges)
}

/// Caractère comparé : tel quel avec casse, sinon sa minuscule (si elle tient en un seul
/// caractère, pour que les indices restent ceux du texte d'origine).
fn fold(c: char, case_sensitive: bool) -> char {
    if case_sensitive {
        return c;
    }
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
