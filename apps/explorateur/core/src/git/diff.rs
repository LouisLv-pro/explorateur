//! Diff d'un fichier : `git diff` découpé en blocs, contexte masqué, mots surlignés.

use std::fs;

use similar::{Algorithm, DiffTag, capture_diff_slices};

use super::command::{Location, require_repo};
use super::{
    ChangeStatus, CharRange, Diff, DiffContent, DiffLine, FileChange, Git, Hunk, LineKind,
};
use crate::Result;

/// Au-delà, le diff est replié (« Afficher le diff (N lignes) »).
pub(crate) const MAX_DIFF_LINES: u32 = 2000;
/// Au-delà (en caractères), une ligne n'a pas de mots surlignés : le diff de caractères est
/// quadratique au pire.
const MAX_WORD_DIFF_CHARS: usize = 1000;

pub(super) fn get_diff(git: &Git, root: &str, change: &FileChange) -> Result<Diff> {
    let location = require_repo(git, root)?;
    Ok(compute(git, &location, change)?.diff)
}

pub(super) fn get_hidden_lines(
    git: &Git,
    root: &str,
    change: &FileChange,
    gap: u32,
) -> Result<Vec<DiffLine>> {
    let location = require_repo(git, root)?;
    let computed = compute(git, &location, change)?;
    let DiffContent::Text { hunks, .. } = &computed.diff.content else {
        return Ok(Vec::new());
    };
    let gap = gap as usize;
    if gap > hunks.len() {
        return Ok(Vec::new());
    }
    // Lignes masquées : de la fin du bloc précédent (ou du début) au bloc `gap` (ou à la fin).
    let (old_prev, new_prev) = match gap.checked_sub(1).and_then(|i| hunks.get(i)) {
        Some(prev) => (
            end_line(prev.old_start, prev.old_count),
            end_line(prev.new_start, prev.new_count),
        ),
        None => (0, 0),
    };
    let new_last = match hunks.get(gap) {
        Some(hunk) => before_line(hunk.new_start, hunk.new_count),
        None => u32::try_from(computed.new_lines.len()).unwrap_or(u32::MAX),
    };
    let last_index = computed.new_lines.len();
    Ok((new_prev + 1..=new_last)
        .filter_map(|new_number| {
            let index = (new_number - 1) as usize;
            let text = computed.new_lines.get(index)?;
            Some(DiffLine {
                kind: LineKind::Context,
                old_number: Some(new_number - new_prev + old_prev),
                new_number: Some(new_number),
                text: text.clone(),
                no_newline: index + 1 == last_index && !computed.new_ends_with_newline,
                changes: Vec::new(),
            })
        })
        .collect())
}

/// Diff calculé et texte de la nouvelle version (pour le contexte masqué).
struct Computed {
    diff: Diff,
    new_lines: Vec<String>,
    new_ends_with_newline: bool,
}

/// Les deux versions comparées d'une modification.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    /// Version de HEAD.
    Head,
    /// Version de l'index.
    Index,
    /// Fichier sur le disque.
    Disk,
    /// Rien (non suivi : pas d'ancienne version).
    Empty,
}

fn sides(change: &FileChange) -> (Side, Side) {
    if change.status == ChangeStatus::Untracked {
        (Side::Empty, Side::Disk)
    } else if change.staged {
        (Side::Head, Side::Index)
    } else {
        (Side::Index, Side::Disk)
    }
}

fn compute(git: &Git, location: &Location, change: &FileChange) -> Result<Computed> {
    let (old_side, new_side) = sides(change);
    let raw = run_diff(git, location, change)?;
    let parsed = parse_unified(&String::from_utf8_lossy(&raw));
    let old_path = change
        .orig_repo_path
        .as_deref()
        .unwrap_or(&change.repo_path);
    let new_path = change.repo_path.as_str();

    if parsed.binary {
        return Ok(Computed {
            diff: Diff {
                old_mode: parsed.old_mode,
                new_mode: parsed.new_mode,
                content: DiffContent::Binary {
                    old_size: size_of(git, location, old_side, old_path),
                    new_size: size_of(git, location, new_side, new_path),
                },
            },
            new_lines: Vec::new(),
            new_ends_with_newline: true,
        });
    }
    if parsed.hunks.is_empty() {
        return Ok(Computed {
            diff: Diff {
                old_mode: parsed.old_mode,
                new_mode: parsed.new_mode,
                content: DiffContent::Identical,
            },
            new_lines: Vec::new(),
            new_ends_with_newline: true,
        });
    }

    let new_text = read_side(git, location, new_side, new_path);
    let new_ends_with_newline = new_text.is_empty() || new_text.ends_with('\n');
    let new_lines = split_lines(&new_text);
    let total = u32::try_from(new_lines.len()).unwrap_or(u32::MAX);

    let mut hunks = parsed.hunks;
    let mut prev_end = 0;
    for hunk in &mut hunks {
        hunk.hidden_before = before_line(hunk.new_start, hunk.new_count).saturating_sub(prev_end);
        prev_end = end_line(hunk.new_start, hunk.new_count);
        mark_word_changes(&mut hunk.lines);
    }
    let hidden_after = total.saturating_sub(prev_end);
    let line_count = hunks
        .iter()
        .map(|h| u32::try_from(h.lines.len()).unwrap_or(u32::MAX))
        .fold(0u32, u32::saturating_add);
    Ok(Computed {
        diff: Diff {
            old_mode: parsed.old_mode,
            new_mode: parsed.new_mode,
            content: DiffContent::Text {
                hunks,
                hidden_after,
                line_count,
                too_long: line_count > MAX_DIFF_LINES,
            },
        },
        new_lines,
        new_ends_with_newline,
    })
}

/// Dernière ligne occupée par un bloc (`start` si le bloc n'a aucune ligne de ce côté : il se
/// place alors après la ligne `start`).
fn end_line(start: u32, count: u32) -> u32 {
    if count == 0 { start } else { start + count - 1 }
}

/// Dernière ligne avant un bloc.
fn before_line(start: u32, count: u32) -> u32 {
    if count == 0 {
        start
    } else {
        start.saturating_sub(1)
    }
}

fn run_diff(git: &Git, location: &Location, change: &FileChange) -> Result<Vec<u8>> {
    let base = ["diff", "--no-color", "--no-ext-diff", "-U3"];
    if change.status == ChangeStatus::Untracked {
        let mut args = base.to_vec();
        args.extend(["--no-index", "--", "/dev/null", change.repo_path.as_str()]);
        return git.run(&location.top, &args, true);
    }
    let mut args = base.to_vec();
    if change.staged {
        args.extend(["--cached", "-M"]);
    }
    args.push("--");
    if let Some(orig) = change.orig_repo_path.as_deref().filter(|_| change.staged) {
        args.push(orig);
    }
    args.push(change.repo_path.as_str());
    git.run(&location.top, &args, false)
}

/// Texte d'une version (vide si elle n'existe pas : ajout, suppression, HEAD sans commit).
fn read_side(git: &Git, location: &Location, side: Side, path: &str) -> String {
    let bytes = match side {
        Side::Empty => return String::new(),
        Side::Disk => fs::read(location.top.join(path)).ok(),
        Side::Head => git
            .run(&location.top, &["show", &format!("HEAD:{path}")], false)
            .ok(),
        Side::Index => git
            .run(&location.top, &["show", &format!(":{path}")], false)
            .ok(),
    };
    bytes
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default()
}

/// Taille en octets d'une version, `None` si elle n'existe pas.
fn size_of(git: &Git, location: &Location, side: Side, path: &str) -> Option<u64> {
    let object = match side {
        Side::Empty => return None,
        Side::Disk => return fs::metadata(location.top.join(path)).ok().map(|m| m.len()),
        Side::Head => format!("HEAD:{path}"),
        Side::Index => format!(":{path}"),
    };
    let out = git
        .run(&location.top, &["cat-file", "-s", &object], false)
        .ok()?;
    String::from_utf8_lossy(&out).trim().parse().ok()
}

/// Lignes d'un texte, sans fin de ligne (`\n` ou `\r\n`).
fn split_lines(text: &str) -> Vec<String> {
    let body = text.strip_suffix('\n').unwrap_or(text);
    if text.is_empty() {
        return Vec::new();
    }
    body.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_owned())
        .collect()
}

/// Diff unifié lu.
#[derive(Default)]
struct Parsed {
    old_mode: Option<String>,
    new_mode: Option<String>,
    binary: bool,
    hunks: Vec<Hunk>,
}

/// Lit la sortie de `git diff` d'un fichier. Dans un bloc, les lignes sont comptées d'après
/// l'en-tête `@@` : une ligne de contenu qui ressemble à un en-tête reste une ligne.
fn parse_unified(text: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        if let Some(mode) = line.strip_prefix("old mode ") {
            parsed.old_mode = Some(mode.to_owned());
        } else if let Some(mode) = line.strip_prefix("new mode ") {
            parsed.new_mode = Some(mode.to_owned());
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            parsed.binary = true;
        } else if let Some(header) = parse_hunk_header(line) {
            let mut hunk = Hunk {
                old_start: header.0,
                old_count: header.1,
                new_start: header.2,
                new_count: header.3,
                hidden_before: 0,
                lines: Vec::new(),
            };
            let (mut old_left, mut new_left) = (hunk.old_count, hunk.new_count);
            let (mut old_no, mut new_no) = (hunk.old_start, hunk.new_start);
            while old_left > 0 || new_left > 0 {
                let Some(raw) = lines.next() else { break };
                if raw.starts_with('\\') {
                    mark_no_newline(&mut hunk.lines);
                    continue;
                }
                let (kind, body) = match raw.chars().next() {
                    Some('+') => (LineKind::Added, &raw[1..]),
                    Some('-') => (LineKind::Removed, &raw[1..]),
                    Some(' ') => (LineKind::Context, &raw[1..]),
                    // Ligne vide sans son espace (sortie retouchée) : contexte vide.
                    _ => (LineKind::Context, raw),
                };
                let (old_number, new_number) = match kind {
                    LineKind::Context => {
                        old_left = old_left.saturating_sub(1);
                        new_left = new_left.saturating_sub(1);
                        old_no += 1;
                        new_no += 1;
                        (Some(old_no - 1), Some(new_no - 1))
                    }
                    LineKind::Removed => {
                        old_left = old_left.saturating_sub(1);
                        old_no += 1;
                        (Some(old_no - 1), None)
                    }
                    LineKind::Added => {
                        new_left = new_left.saturating_sub(1);
                        new_no += 1;
                        (None, Some(new_no - 1))
                    }
                };
                hunk.lines.push(DiffLine {
                    kind,
                    old_number,
                    new_number,
                    text: body.strip_suffix('\r').unwrap_or(body).to_owned(),
                    no_newline: false,
                    changes: Vec::new(),
                });
            }
            // `\ No newline at end of file` après la dernière ligne du bloc.
            if lines.peek().is_some_and(|l| l.starts_with('\\')) {
                lines.next();
                mark_no_newline(&mut hunk.lines);
            }
            parsed.hunks.push(hunk);
        }
    }
    parsed
}

fn mark_no_newline(lines: &mut [DiffLine]) {
    if let Some(last) = lines.last_mut() {
        last.no_newline = true;
    }
}

/// `@@ -a[,b] +c[,d] @@…` → `(a, b, c, d)` (compte 1 par défaut).
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let rest = line.strip_prefix("@@ -")?;
    let (ranges, _) = rest.split_once(" @@")?;
    let (old, new) = ranges.split_once(" +")?;
    let range = |r: &str| -> Option<(u32, u32)> {
        match r.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((r.parse().ok()?, 1)),
        }
    };
    let (a, b) = range(old)?;
    let (c, d) = range(new)?;
    Some((a, b, c, d))
}

/// Mots surlignés : dans chaque suite de lignes supprimées suivie de lignes ajoutées, la
/// i-ème supprimée est appariée à la i-ème ajoutée, et leurs caractères changés repérés.
pub(crate) fn mark_word_changes(lines: &mut [DiffLine]) {
    let mut i = 0;
    while i < lines.len() {
        let removed_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Removed {
            i += 1;
        }
        let added_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Added {
            i += 1;
        }
        let pairs = (added_start - removed_start).min(i - added_start);
        for k in 0..pairs {
            let (old, new) =
                char_changes(&lines[removed_start + k].text, &lines[added_start + k].text);
            lines[removed_start + k].changes = old;
            lines[added_start + k].changes = new;
        }
        if i == removed_start {
            i += 1;
        }
    }
}

/// Plages changées de deux lignes appariées, en unités UTF-16. Rien si les lignes sont trop
/// longues ou trop différentes (moins d'un tiers en commun : tout serait surligné).
fn char_changes(old: &str, new: &str) -> (Vec<CharRange>, Vec<CharRange>) {
    let old_chars: Vec<char> = old.chars().collect();
    let new_chars: Vec<char> = new.chars().collect();
    if old_chars.len() > MAX_WORD_DIFF_CHARS || new_chars.len() > MAX_WORD_DIFF_CHARS {
        return (Vec::new(), Vec::new());
    }
    let ops = capture_diff_slices(Algorithm::Myers, &old_chars, &new_chars);
    let common: usize = ops
        .iter()
        .filter(|op| op.tag() == DiffTag::Equal)
        .map(|op| op.old_range().len())
        .sum();
    if common * 3 < old_chars.len().max(new_chars.len()) {
        return (Vec::new(), Vec::new());
    }
    let old_units = utf16_offsets(&old_chars);
    let new_units = utf16_offsets(&new_chars);
    let mut old_ranges = Vec::new();
    let mut new_ranges = Vec::new();
    for op in &ops {
        let (tag, old_range, new_range) = op.as_tag_tuple();
        if tag == DiffTag::Equal {
            continue;
        }
        push_range(&mut old_ranges, &old_units, old_range);
        push_range(&mut new_ranges, &new_units, new_range);
    }
    (old_ranges, new_ranges)
}

/// Indice UTF-16 de chaque caractère, plus la longueur totale en dernier.
fn utf16_offsets(chars: &[char]) -> Vec<u32> {
    let mut offsets = Vec::with_capacity(chars.len() + 1);
    let mut unit = 0u32;
    for c in chars {
        offsets.push(unit);
        unit += u32::try_from(c.len_utf16()).unwrap_or(2);
    }
    offsets.push(unit);
    offsets
}

/// Ajoute une plage de caractères (vide ignorée), fusionnée avec la précédente si contiguë.
fn push_range(ranges: &mut Vec<CharRange>, units: &[u32], chars: std::ops::Range<usize>) {
    if chars.is_empty() {
        return;
    }
    let (Some(&start), Some(&end)) = (units.get(chars.start), units.get(chars.end)) else {
        return;
    };
    match ranges.last_mut() {
        Some(last) if last.end == start => last.end = end,
        _ => ranges.push(CharRange { start, end }),
    }
}
