//! Apps Electron (spec `apps-commandes.md`, décision 0023) : un `package.json` qui dépend
//! d'`electron` et dont un script lance l'app donne une app, lancée par `<gestionnaire> run
//! <script>`. Ce script cesse d'être un serveur.

use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use super::{AppKind, NativeApp, command_app};
use crate::servers::{package_manager, read_package};

/// Scripts préférés, dans cet ordre, quand plusieurs lancent Electron, et repli quand aucun
/// ne le lance (plugin Vite qui lance Electron).
const PREFERRED: [&str; 2] = ["start", "dev"];

/// App Electron du `package.json` de `dir`, s'il y en a une.
pub(super) fn electron_app(root: &Path, dir: &Path, relative_dir: &str) -> Option<NativeApp> {
    let (name, scripts) = read_package(dir)?;
    let script = electron_script(dir, &scripts)?;
    let command = format!("{} run {script}", package_manager(root, dir));
    Some(command_app(
        &name,
        dir,
        relative_dir,
        (&format!("script:{script}"), "electron", AppKind::Electron),
        command,
    ))
}

/// Script qui lance l'app Electron du `package.json` de `dir` (`scripts` : ses scripts).
/// `None` sans dépendance `electron`, ou sans script utilisable. Utilisé aussi par les serveurs
/// pour écarter ce script de leur liste.
pub(crate) fn electron_script(dir: &Path, scripts: &Map<String, Value>) -> Option<String> {
    if !depends_on_electron(dir) {
        return None;
    }
    let mut launching: Vec<&str> = scripts
        .iter()
        .filter(|(_, text)| text.as_str().is_some_and(launches_electron))
        .map(|(script, _)| script.as_str())
        .collect();
    launching.sort_unstable();

    PREFERRED
        .iter()
        .find(|script| launching.contains(script))
        .copied()
        .or_else(|| launching.first().copied())
        .or_else(|| {
            PREFERRED
                .iter()
                .find(|script| scripts.get(**script).is_some_and(Value::is_string))
                .copied()
        })
        .map(str::to_owned)
}

/// Vrai si `dependencies` ou `devDependencies` contient `electron`.
fn depends_on_electron(dir: &Path) -> bool {
    let Ok(text) = fs::read_to_string(dir.join("package.json")) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    ["dependencies", "devDependencies"].iter().any(|section| {
        json.get(section)
            .and_then(Value::as_object)
            .is_some_and(|deps| deps.contains_key("electron"))
    })
}

/// Vrai si la commande lance Electron : le mot entier `electron` (guillemets ignorés, séparateurs
/// `&&`, `||`, `;`, `|`, `&` et espaces), `electron-forge start` ou `electron-vite dev`.
/// `electron-builder` et les autres `electron-*` ne comptent pas.
fn launches_electron(command: &str) -> bool {
    let spaced = command.replace([';', '|', '&'], " ");
    let words: Vec<&str> = spaced
        .split_whitespace()
        .map(|word| word.trim_matches(['"', '\'']))
        .collect();
    words.iter().enumerate().any(|(i, word)| match *word {
        "electron" => true,
        "electron-forge" => words.get(i + 1) == Some(&"start"),
        "electron-vite" => words.get(i + 1) == Some(&"dev"),
        _ => false,
    })
}
