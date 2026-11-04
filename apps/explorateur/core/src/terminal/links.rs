//! Détection des liens fichier dans une ligne de terminal (⌘clic, fournisseur de liens d'xterm).

use std::path::{Component, Path, PathBuf};

/// Lien vers un fichier trouvé dans une ligne de terminal.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileLink {
    /// Début du lien, en unités UTF-16 depuis le début de la ligne (indice de chaîne JavaScript),
    /// à partir de 0, inclus. Le front le convertit en colonnes de cellules pour `ILink.range`.
    pub start: u32,
    /// Fin du lien, en unités UTF-16, exclue. Le lien couvre le chemin et son suffixe
    /// `:ligne[:colonne]`, sans la ponctuation qui l'entoure.
    pub end: u32,
    /// Chemin absolu du fichier, sans `.` ni `..`.
    pub path: String,
    /// Ligne (`:12`), à partir de 1.
    pub line: Option<u32>,
    /// Colonne (`:12:5`), à partir de 1.
    pub column: Option<u32>,
}

/// Liens fichier de `text`, dans l'ordre de la ligne : chemins absolus, ou relatifs à `cwd`
/// (dossier de départ de la page), suivis de `:ligne` ou `:ligne:colonne` facultatifs, entourés
/// ou non de ponctuation (parenthèses, crochets, guillemets, apostrophes, `:` ou `.` final).
///
/// Seuls les fichiers existants sous `root` sont des liens (après résolution des `..` et des
/// liens symboliques) : un chemin inexistant, un dossier ou un chemin hors de `root` ne l'est
/// pas. Les URL `http(s)` sont traitées par le front.
///
/// Limite : un chemin ne contient pas d'espace (les mots de la ligne sont séparés par les
/// blancs).
pub fn find_file_links(text: &str, cwd: &str, root: &str) -> Vec<FileLink> {
    let Ok(root_real) = Path::new(root).canonicalize() else {
        return Vec::new();
    };
    words(text)
        .filter_map(|(start, word)| {
            let (lead, word) = trim_punctuation(word);
            let (path, line, column) = split_position(word);
            let path = resolve(path, cwd, &root_real)?;
            let start = start + utf16_len(lead);
            Some(FileLink {
                start: to_u32(start),
                end: to_u32(start + utf16_len(word)),
                path,
                line,
                column,
            })
        })
        .collect()
}

/// Ponctuation retirée au début d'un mot.
const LEADING: &[char] = &['(', '[', '{', '<', '"', '\'', '`'];
/// Ponctuation retirée à la fin d'un mot (dont le `:` qui suit `fichier:12:5:` chez rustc).
const TRAILING: &[char] = &[
    ')', ']', '}', '>', '"', '\'', '`', ',', ';', ':', '.', '!', '?',
];
/// Au-delà, un mot n'est pas un chemin (évite de solliciter le disque pour rien).
const MAX_WORD: usize = 4096;

/// Mots de `text` (séparés par des blancs), avec leur début en unités UTF-16.
fn words(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut utf16 = 0usize;
    let mut current: Option<(usize, usize)> = None; // (octet de début, UTF-16 de début)
    let mut out = Vec::new();
    for (byte, c) in text.char_indices() {
        if c.is_whitespace() {
            if let Some((b, u)) = current.take() {
                out.push((u, text.get(b..byte).unwrap_or_default()));
            }
        } else if current.is_none() {
            current = Some((byte, utf16));
        }
        utf16 += c.len_utf16();
    }
    if let Some((b, u)) = current {
        out.push((u, text.get(b..).unwrap_or_default()));
    }
    out.into_iter()
        .filter(|(_, w)| !w.is_empty() && w.len() <= MAX_WORD)
}

/// Retire la ponctuation autour de `word` : renvoie la partie retirée au début et le reste.
fn trim_punctuation(word: &str) -> (&str, &str) {
    let rest = word.trim_start_matches(LEADING);
    let lead = word.get(..word.len() - rest.len()).unwrap_or_default();
    (lead, rest.trim_end_matches(TRAILING))
}

/// Sépare `chemin:ligne:colonne` (suffixes facultatifs).
fn split_position(word: &str) -> (&str, Option<u32>, Option<u32>) {
    let number = |s: &str| {
        (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse::<u32>().ok())
            .flatten()
    };
    let Some((before, last)) = word.rsplit_once(':') else {
        return (word, None, None);
    };
    let Some(last) = number(last) else {
        return (word, None, None);
    };
    if let Some((path, line)) = before.rsplit_once(':')
        && let Some(line) = number(line)
    {
        return (path, Some(line), Some(last));
    }
    (before, Some(last), None)
}

/// Chemin absolu (normalisé sans `.` ni `..`) de `path` s'il désigne un fichier existant sous
/// `root_real` (chemin canonique de la racine, liens symboliques résolus).
fn resolve(path: &str, cwd: &str, root_real: &Path) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let joined = Path::new(cwd).join(path);
    let real = joined.canonicalize().ok()?;
    if !real.starts_with(root_real) || !real.is_file() {
        return None;
    }
    Some(normalize(&joined).to_string_lossy().into_owned())
}

/// Retire `.` et `..` sans toucher au disque (garde la forme du chemin de la racine).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
