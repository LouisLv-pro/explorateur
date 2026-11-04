//! Apps Rust (spec `apps-commandes.md`, décision 0023) : une app par binaire d'un `Cargo.toml`
//! avec `[package]`, lancée par `cargo run`. Les règles de découverte des binaires de Cargo sont
//! réimplémentées sur le texte du manifeste, sans `cargo metadata` (lent, peut échouer hors ligne).

use std::fs;
use std::path::Path;

use toml::{Table, Value};

use super::{AppKind, NativeApp, cap_per_package, command_app, in_excluded_dir};
use crate::terminal::shell_quote;

/// Binaire d'un package.
struct Bin {
    name: String,
    /// `path` d'un `[[bin]]` (relatif au package) ; `None` pour un binaire automatique.
    path: Option<String>,
    /// Le binaire déclare `required-features` : il ne se lance pas sans option.
    required_features: bool,
}

/// Apps du `Cargo.toml` de `dir`. Un fichier illisible ou mal formé, un workspace virtuel,
/// une bibliothèque et une crate Tauri ne donnent rien.
pub(super) fn rust_apps(dir: &Path, relative_dir: &str) -> Vec<NativeApp> {
    let Ok(text) = fs::read_to_string(dir.join("Cargo.toml")) else {
        return Vec::new();
    };
    let Ok(manifest) = text.parse::<Table>() else {
        return Vec::new();
    };
    let Some(package) = manifest.get("package").and_then(Value::as_table) else {
        return Vec::new();
    };
    let Some(package_name) = package.get("name").and_then(Value::as_str) else {
        return Vec::new();
    };
    if depends_on_tauri(&manifest) {
        return Vec::new();
    }

    let bins = binaries(dir, package_name, package, &manifest);
    // Compté avant filtrage : cargo refuse de choisir seul entre plusieurs binaires.
    let alone = bins.len() == 1;
    let default_run = package.get("default-run").and_then(Value::as_str);
    let kept: Vec<Bin> = bins.into_iter().filter(|bin| !is_noise(bin)).collect();
    let priority = |bin: &Bin| {
        let rank = if Some(bin.name.as_str()) == default_run {
            0
        } else if bin.name == package_name {
            1
        } else {
            2
        };
        (rank, bin.name.clone())
    };

    cap_per_package(kept, priority)
        .into_iter()
        .map(|bin| {
            let command = if alone {
                "cargo run".to_owned()
            } else {
                format!("cargo run --bin {}", shell_quote(&bin.name))
            };
            command_app(
                &bin.name,
                dir,
                relative_dir,
                (&format!("bin:{}", bin.name), "cargo run", AppKind::Rust),
                command,
            )
        })
        .collect()
}

/// Vrai si le package dépend de `tauri` ou de `tauri-build` : son app est déjà couverte par le
/// script `tauri dev`.
fn depends_on_tauri(manifest: &Table) -> bool {
    let has = |section: &str, dependency: &str| {
        manifest
            .get(section)
            .and_then(Value::as_table)
            .is_some_and(|deps| deps.contains_key(dependency))
    };
    has("dependencies", "tauri") || has("build-dependencies", "tauri-build")
}

/// Binaires du package selon Cargo : `src/main.rs`, `src/bin/<x>.rs` et `src/bin/<x>/main.rs`
/// (sauf `autobins = false`), puis les `[[bin]]`, qui remplacent le binaire automatique de
/// même nom.
fn binaries(dir: &Path, package_name: &str, package: &Table, manifest: &Table) -> Vec<Bin> {
    let mut bins = Vec::new();
    if package.get("autobins").and_then(Value::as_bool) != Some(false) {
        if dir.join("src/main.rs").is_file() {
            bins.push(automatic(package_name));
        }
        bins.extend(
            bin_dir_names(&dir.join("src/bin"))
                .iter()
                .map(|name| automatic(name)),
        );
    }

    let declared = manifest
        .get("bin")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_table);
    for table in declared {
        let Some(name) = table.get("name").and_then(Value::as_str) else {
            continue;
        };
        bins.retain(|bin| bin.name != name);
        bins.push(Bin {
            name: name.to_owned(),
            path: table.get("path").and_then(Value::as_str).map(str::to_owned),
            required_features: table.contains_key("required-features"),
        });
    }
    bins
}

fn automatic(name: &str) -> Bin {
    Bin {
        name: name.to_owned(),
        path: None,
        required_features: false,
    }
}

/// Noms des binaires automatiques de `src/bin` : `x.rs` et `x/main.rs`.
fn bin_dir_names(bin_dir: &Path) -> Vec<String> {
    let Ok(reader) = fs::read_dir(bin_dir) else {
        return Vec::new();
    };
    reader
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                path.join("main.rs").is_file().then_some(name)
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                path.file_stem().map(|s| s.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}

/// Binaires de développement à écarter : outils `xtask`, binaires qui exigent des options
/// (`required-features`), binaires déclarés dans un dossier d'exemples, de benchmarks...
fn is_noise(bin: &Bin) -> bool {
    let name = bin.name.as_str();
    name == "xtask"
        || name.ends_with("-xtask")
        || name.ends_with("_xtask")
        || bin.required_features
        || bin.path.as_deref().is_some_and(in_excluded_dir)
}
