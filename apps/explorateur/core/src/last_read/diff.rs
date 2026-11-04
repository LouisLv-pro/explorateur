//! Diff de lignes entre deux versions lues, dans les types du volet Modifications.

use std::time::{Duration, Instant};

use similar::{Algorithm, DiffTag, capture_diff_slices_deadline, group_diff_ops};

use crate::git::{DiffContent, DiffLine, Hunk, LineKind, MAX_DIFF_LINES, mark_word_changes};

/// Lignes de contexte autour de chaque bloc, comme `git diff -U3`.
const CONTEXT: usize = 3;
/// Temps maximal du diff : au-delà, `similar` donne un diff approché, toujours correct.
const TIMEOUT: Duration = Duration::from_secs(1);

/// Diff de `old` à `new` : blocs, lignes ajoutées, lignes supprimées.
pub(super) fn diff_texts(old: &str, new: &str) -> (DiffContent, u32, u32) {
    // Lignes avec leur fin : une dernière ligne sans `\n` diffère de la même avec, comme git.
    let old_lines: Vec<&str> = old.split_inclusive('\n').collect();
    let new_lines: Vec<&str> = new.split_inclusive('\n').collect();
    let deadline = Instant::now().checked_add(TIMEOUT);
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &old_lines, &new_lines, deadline);

    let (mut added, mut removed) = (0u32, 0u32);
    for op in &ops {
        let (tag, old_range, new_range) = op.as_tag_tuple();
        if matches!(tag, DiffTag::Delete | DiffTag::Replace) {
            removed = removed.saturating_add(to_u32(old_range.len()));
        }
        if matches!(tag, DiffTag::Insert | DiffTag::Replace) {
            added = added.saturating_add(to_u32(new_range.len()));
        }
    }

    let mut hunks = Vec::new();
    // Fin (0-indexée, exclue) du bloc précédent dans la nouvelle version.
    let mut prev_end = 0usize;
    for group in group_diff_ops(ops, CONTEXT) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let old_from = first.old_range().start;
        let new_from = first.new_range().start;
        let old_count = last.old_range().end - old_from;
        let new_count = last.new_range().end - new_from;
        let mut lines = Vec::new();
        for op in &group {
            let (tag, old_range, new_range) = op.as_tag_tuple();
            match tag {
                DiffTag::Equal => {
                    for (o, n) in old_range.zip(new_range) {
                        lines.push(line(LineKind::Context, Some(o), Some(n), new_lines[n]));
                    }
                }
                DiffTag::Delete | DiffTag::Insert | DiffTag::Replace => {
                    for o in old_range {
                        lines.push(line(LineKind::Removed, Some(o), None, old_lines[o]));
                    }
                    for n in new_range {
                        lines.push(line(LineKind::Added, None, Some(n), new_lines[n]));
                    }
                }
            }
        }
        mark_word_changes(&mut lines);
        hunks.push(Hunk {
            old_start: start(old_from, old_count),
            old_count: to_u32(old_count),
            new_start: start(new_from, new_count),
            new_count: to_u32(new_count),
            hidden_before: to_u32(new_from.saturating_sub(prev_end)),
            lines,
        });
        prev_end = new_from + new_count;
    }

    let line_count = hunks
        .iter()
        .map(|h| to_u32(h.lines.len()))
        .fold(0u32, u32::saturating_add);
    let diff = DiffContent::Text {
        hidden_after: to_u32(new_lines.len().saturating_sub(prev_end)),
        hunks,
        line_count,
        too_long: line_count > MAX_DIFF_LINES,
    };
    (diff, added, removed)
}

/// Ligne de diff ; `old` et `new` sont des indices 0-indexés.
fn line(kind: LineKind, old: Option<usize>, new: Option<usize>, raw: &str) -> DiffLine {
    let body = raw.strip_suffix('\n');
    let text = body.unwrap_or(raw);
    DiffLine {
        kind,
        old_number: old.map(|i| to_u32(i + 1)),
        new_number: new.map(|i| to_u32(i + 1)),
        text: text.strip_suffix('\r').unwrap_or(text).to_owned(),
        no_newline: body.is_none(),
        changes: Vec::new(),
    }
}

/// Première ligne d'un bloc comme dans `@@ -a,b` : sans ligne de ce côté, la ligne après
/// laquelle il se place (0 en tête).
fn start(from: usize, count: usize) -> u32 {
    if count == 0 {
        to_u32(from)
    } else {
        to_u32(from + 1)
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
