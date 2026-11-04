//! Projets Gradle d'app Android (spec `apps-android.md`, décision 0021) : modules et plugins
//! lus dans le texte des fichiers de réglages, de compilation et du catalogue de versions,
//! sans exécuter Gradle (trop lent pour le menu) ni crate d'analyse.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::{AppKind, AppTarget, DeviceSource, NativeApp};
use crate::servers::{folder_name, relative_dir};

/// Identifiant du plugin Gradle d'une app Android.
const APPLICATION: &str = "com.android.application";

/// Apps des projets Gradle trouvés : une par projet qui a au moins un module d'application.
pub(super) fn gradle_apps(root: &Path, dirs: &[PathBuf]) -> Vec<NativeApp> {
    dirs.iter()
        .filter_map(|dir| project_app(root, dir))
        .collect()
}

/// App d'un projet Gradle, avec une cible par module d'application (`android`, ou
/// `android:<module>` s'il y en a plusieurs) ; rien si son fichier de réglages est illisible.
fn project_app(root: &Path, dir: &Path) -> Option<NativeApp> {
    let settings = read_first(dir, &["settings.gradle.kts", "settings.gradle"])?;
    let settings = strip_comments(&settings);
    let project = root_project_name(&settings).unwrap_or_else(|| folder_name(dir));
    let aliases = fs::read_to_string(dir.join("gradle").join("libs.versions.toml"))
        .map(|toml| application_aliases(&toml))
        .unwrap_or_default();
    let modules: Vec<String> = included_modules(&settings)
        .into_iter()
        .filter(|module| {
            read_first(
                &dir.join(module.replace(':', "/")),
                &["build.gradle.kts", "build.gradle"],
            )
            .is_some_and(|build| applies_application(&strip_comments(&build), &aliases))
        })
        .collect();

    if modules.is_empty() {
        return None;
    }
    let dir_text = dir.to_string_lossy().into_owned();
    let several = modules.len() > 1;
    let targets = modules
        .into_iter()
        .map(|module| {
            let (id, label) = if several {
                (format!("android:{module}"), format!("Android ({module})"))
            } else {
                ("android".to_owned(), "Android".to_owned())
            };
            AppTarget {
                id,
                label,
                kind: AppKind::Android,
                device_source: Some(DeviceSource::AndroidDevices),
                project: Some(dir_text.clone()),
                scheme: Some(format!(":{module}")),
                command: None,
            }
        })
        .collect();
    Some(NativeApp {
        name: project,
        dir: dir_text,
        relative_dir: relative_dir(root, dir),
        targets,
    })
}

/// Texte du premier fichier lisible de `names` dans `dir`.
fn read_first(dir: &Path, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| fs::read_to_string(dir.join(name)).ok())
}

/// Texte sans les lignes commentées (`//`). Un `//` en fin de ligne est gardé : il peut faire
/// partie d'une URL (`maven("https://…")`).
fn strip_comments(text: &str) -> String {
    text.lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Valeur de `rootProject.name`.
fn root_project_name(settings: &str) -> Option<String> {
    let line = settings
        .lines()
        .find(|line| line.trim_start().starts_with("rootProject.name"))?;
    quoted_strings(line)
        .first()
        .filter(|name| !name.is_empty())
        .map(|name| (*name).to_owned())
}

/// Modules des instructions `include`, sans le `:` de tête (`feature:app`), sans doublon.
/// `include(…)` est lu jusqu'à sa parenthèse fermante (plusieurs lignes), `include '…'` jusqu'à
/// la fin de la ligne. `includeBuild` et `includeFlat` ne sont pas des modules.
fn included_modules(settings: &str) -> Vec<String> {
    const KEYWORD: &str = "include";
    let mut modules: Vec<String> = Vec::new();
    let mut rest = settings;
    while let Some(pos) = rest.find(KEYWORD) {
        let starts_word = rest[..pos]
            .chars()
            .next_back()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_' || c == '.'));
        let after = &rest[pos + KEYWORD.len()..];
        rest = after;
        if !starts_word {
            continue;
        }
        let trimmed = after.trim_start_matches([' ', '\t']);
        let args = if let Some(inner) = trimmed.strip_prefix('(') {
            inner.split(')').next().unwrap_or_default()
        } else if after.starts_with([' ', '\t']) {
            trimmed.lines().next().unwrap_or_default()
        } else {
            continue;
        };
        for module in quoted_strings(args) {
            let module = module.trim().trim_start_matches(':');
            if !module.is_empty() && !modules.iter().any(|m| m == module) {
                modules.push(module.to_owned());
            }
        }
    }
    modules
}

/// Chaînes entre guillemets simples ou doubles, dans l'ordre.
fn quoted_strings(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(['"', '\'']) {
        let quote = if rest[start..].starts_with('"') {
            '"'
        } else {
            '\''
        };
        let after = &rest[start + 1..];
        let Some(end) = after.find(quote) else {
            break;
        };
        found.push(&after[..end]);
        rest = &after[end + 1..];
    }
    found
}

/// Vrai si un `build.gradle(.kts)` applique le plugin d'application : par son identifiant entre
/// guillemets (`id(…)`, `id '…'`, `apply plugin: '…'`), ou par un alias du catalogue
/// (`alias(<catalogue>.plugins.<clé>)`) dont la clé est dans `aliases`.
fn applies_application(build: &str, aliases: &BTreeSet<String>) -> bool {
    if build.contains(&format!("\"{APPLICATION}\"")) || build.contains(&format!("'{APPLICATION}'"))
    {
        return true;
    }
    build.split("alias(").skip(1).any(|rest| {
        let argument = rest.split(')').next().unwrap_or_default().trim();
        let mut parts = argument.split('.');
        // Le nom du catalogue (`libs`, `deps`) importe peu : seul `gradle/libs.versions.toml` est lu.
        let _catalog = parts.next();
        parts.next() == Some("plugins") && aliases.contains(&parts.collect::<Vec<_>>().join("."))
    })
}

/// Clés de la section `[plugins]` d'un catalogue de versions dont l'identifiant est le plugin
/// d'application, tirets et soulignés changés en points (forme de l'alias : `android.application`).
fn application_aliases(toml: &str) -> BTreeSet<String> {
    let mut aliases = BTreeSet::new();
    let mut in_plugins = false;
    for line in toml.lines() {
        let line = line.split('#').next().unwrap_or_default().trim();
        if line.starts_with('[') {
            in_plugins = line == "[plugins]";
            continue;
        }
        let Some((key, value)) = line.split_once('=').filter(|_| in_plugins) else {
            continue;
        };
        if plugin_id(value) == Some(APPLICATION) {
            aliases.insert(key.trim().trim_matches('"').replace(['-', '_'], "."));
        }
    }
    aliases
}

/// Identifiant d'une entrée de plugin : `{ id = "…", version = "…" }` ou `"<id>:<version>"`.
fn plugin_id(value: &str) -> Option<&str> {
    let value = value.trim();
    if let Some(table) = value.strip_prefix('{') {
        table.trim_end_matches('}').split(',').find_map(|part| {
            let (key, value) = part.split_once('=')?;
            (key.trim() == "id").then(|| value.trim().trim_matches('"'))
        })
    } else {
        value.trim_matches('"').split(':').next()
    }
}
