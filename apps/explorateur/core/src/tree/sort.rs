//! Ordre des noms : casse et accents ignorés, nombres dans l'ordre naturel.

use std::cmp::Ordering;

use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// Compare deux noms comme un humain : `a` < `Á` < `b`, `page2` < `page10`.
/// À égalité (même nom à la casse ou aux accents près), l'ordre des octets départage,
/// pour un tri stable d'un listage à l'autre.
pub fn compare_names(a: &str, b: &str) -> Ordering {
    natural_cmp(&fold(a), &fold(b)).then_with(|| a.cmp(b))
}

/// Minuscules sans accents (décomposition NFD, puis retrait des marques combinantes).
fn fold(s: &str) -> Vec<char> {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

/// Ordre naturel : une suite de chiffres se compare par sa valeur.
fn natural_cmp(a: &[char], b: &[char]) -> Ordering {
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let end_a = digits_end(a, i);
            let end_b = digits_end(b, j);
            let ord = compare_numbers(&a[i..end_a], &b[j..end_b]);
            if ord != Ordering::Equal {
                return ord;
            }
            i = end_a;
            j = end_b;
        } else {
            let ord = a[i].cmp(&b[j]);
            if ord != Ordering::Equal {
                return ord;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

fn digits_end(s: &[char], start: usize) -> usize {
    s[start..]
        .iter()
        .position(|c| !c.is_ascii_digit())
        .map_or(s.len(), |p| start + p)
}

/// Compare deux suites de chiffres par valeur, sans conversion (pas de dépassement).
fn compare_numbers(a: &[char], b: &[char]) -> Ordering {
    let a = trim_zeros(a);
    let b = trim_zeros(b);
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

fn trim_zeros(s: &[char]) -> &[char] {
    let first = s.iter().position(|c| *c != '0').unwrap_or(s.len());
    &s[first..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leading_zeros_do_not_change_the_value() {
        assert_eq!(compare_names("v007", "v7"), "v007".cmp("v7"));
        assert_eq!(compare_names("v007", "v8"), Ordering::Less);
    }

    #[test]
    fn a_prefix_comes_first() {
        assert_eq!(compare_names("page", "page2"), Ordering::Less);
    }
}
