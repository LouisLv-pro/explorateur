//! Feuille de style commune aux deux moteurs : fond transparent et mise à l'échelle sans script.

use std::fmt::Write;

/// Largeur de diapo par défaut, en px CSS (un deck 16:9 de 12 192 000 EMU).
pub(super) const DEFAULT_WIDTH: u32 = 960;
/// Hauteur de diapo par défaut, en px CSS.
pub(super) const DEFAULT_HEIGHT: u32 = 540;

/// Premier palier de zoom et pas, en centièmes (0,25 puis +0,05 jusqu'à 2).
const FIRST_STEP: u32 = 25;
const STEP: u32 = 5;
const STEPS: u32 = 36;
/// Marges autour des diapos (8 px de chaque côté, doublées pour le défilement).
const MARGINS: u32 = 32;

/// Balise `<style>` : fond transparent, `color-scheme: light dark`, et un `zoom` sur `body` par
/// palier de `@media (min-width)`, pour que des diapos de `slide_width` px tiennent dans la
/// largeur de la fenêtre. Le palier `z` s'applique dès que `z × (largeur + 32)` px sont
/// disponibles ; en dessous du premier, le zoom reste au minimum.
pub(super) fn sheet(slide_width: u32) -> String {
    let mut css = String::from(
        "<style>html,body{background:transparent!important;color-scheme:light dark}\
         body{zoom:0.25}",
    );
    for i in 0..STEPS {
        let z = FIRST_STEP + i * STEP;
        // ⌈z/100 × (largeur + 32)⌉ en entiers.
        let min_width = (z * (slide_width + MARGINS)).div_ceil(100);
        let _ = write!(
            css,
            "@media (min-width:{min_width}px){{body{{zoom:{}.{:02}}}}}",
            z / 100,
            z % 100
        );
    }
    css.push_str("</style>");
    css
}

/// Insère `sheet` en fin de `<head>` ; sans `</head>`, au tout début du document.
pub(super) fn inject(html: &str, sheet: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let at = lower.find("</head>").unwrap_or(0);
    let mut out = String::with_capacity(html.len() + sheet.len());
    out.push_str(&html[..at]);
    out.push_str(sheet);
    out.push_str(&html[at..]);
    out
}

/// Largeur de diapo d'un `Preview.html` de Quick Look, lue dans sa règle
/// `div.slide, div.loading-slide { width: 960; … }` ; `DEFAULT_WIDTH` si elle manque.
pub(super) fn quick_look_width(html: &str) -> u32 {
    const RULE: &str = "div.slide, div.loading-slide {";
    let Some(start) = html.find(RULE) else {
        return DEFAULT_WIDTH;
    };
    let rest = &html[start + RULE.len()..];
    let Some(w) = rest.find("width:") else {
        return DEFAULT_WIDTH;
    };
    let digits: String = rest[w + "width:".len()..]
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits
        .parse()
        .ok()
        .filter(|w| *w > 0)
        .unwrap_or(DEFAULT_WIDTH)
}
