//! Apps Expo et React Native (spec `apps-react-native.md`, décisions 0020 et 0021) : une app par
//! `package.json` qui en dépend, avec les cibles iOS et Android, et leurs commandes de lancement.

use std::fs;
use std::path::Path;

use serde_json::Value;

use super::android::boot_steps;
use super::{AndroidDevice, AppKind, AppTarget, DeviceSource, NativeApp};
use crate::servers::{folder_name, package_manager, relative_dir};
use crate::terminal::shell_quote;

/// Cadre d'un paquet mobile : Expo, ou React Native sans Expo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Framework {
    Expo,
    ReactNative,
}

/// Nom et cadre du `package.json` de `dir` : `expo` dans `dependencies` ou `devDependencies`,
/// sinon `react-native` (clés exactes). `None` s'il est illisible, mal formé ou n'en dépend pas.
/// Les scripts ne comptent pas.
pub(super) fn read_framework(dir: &Path) -> Option<(String, Framework)> {
    let text = fs::read_to_string(dir.join("package.json")).ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    let depends_on = |name: &str| {
        ["dependencies", "devDependencies"].iter().any(|key| {
            json.get(key)
                .and_then(Value::as_object)
                .is_some_and(|deps| deps.contains_key(name))
        })
    };
    let framework = if depends_on("expo") {
        Framework::Expo
    } else if depends_on("react-native") {
        Framework::ReactNative
    } else {
        return None;
    };
    let name = json
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .map_or_else(|| folder_name(dir), str::to_owned);
    Some((name, framework))
}

/// App d'un paquet, cibles `ios` puis `android`. Le genre de la cible dit le cadre (`Expo`,
/// `ReactNative`), sa source d'appareils la plateforme ; `scheme` porte la commande de base
/// (`<exécuteur> expo run:ios`, `<exécuteur> react-native run-android`…).
pub(super) fn package_app(root: &Path, dir: &Path, name: &str, framework: Framework) -> NativeApp {
    // `npm` ne lance pas un binaire du projet : son exécuteur est `npx`.
    let runner = match package_manager(root, dir) {
        "npm" => "npx",
        other => other,
    };
    let (kind, tool, ios, android) = match framework {
        Framework::Expo => (AppKind::Expo, "expo", "run:ios", "run:android"),
        Framework::ReactNative => (
            AppKind::ReactNative,
            "react-native",
            "run-ios",
            "run-android",
        ),
    };
    let targets = [
        ("ios", "iOS", DeviceSource::IosSimulators, ios),
        ("android", "Android", DeviceSource::AndroidDevices, android),
    ]
    .into_iter()
    .map(|(id, label, source, run)| AppTarget {
        id: id.to_owned(),
        label: label.to_owned(),
        kind,
        device_source: Some(source),
        project: None,
        scheme: Some(format!("{runner} {tool} {run}")),
        command: None,
    })
    .collect();
    NativeApp {
        name: name.to_owned(),
        dir: dir.to_string_lossy().into_owned(),
        relative_dir: relative_dir(root, dir),
        targets,
    }
}

/// Commande d'une cible iOS sur le simulateur `simulator_id` (aucun : celui que choisit la CLI).
/// React Native : Metro démarre en arrière-plan et revient au premier plan à la fin (`fg`), sans
/// quoi la CLI l'ouvrirait dans Terminal.app.
pub fn react_native_ios_command(target: &AppTarget, simulator_id: Option<&str>) -> String {
    let base = target.scheme.as_deref().unwrap_or_default();
    if target.kind == AppKind::ReactNative {
        let udid = simulator_id
            .map(|id| format!(" --udid {}", shell_quote(id)))
            .unwrap_or_default();
        return format!("{} && {base}{udid} --no-packager; fg", metro(base));
    }
    match simulator_id {
        Some(id) => format!("{base} --device {}", shell_quote(id)),
        None => base.to_owned(),
    }
}

/// Commande d'une cible Android sur `device`. Expo vise la série d'un appareil démarré, sinon le
/// nom de l'AVD (il démarre l'émulateur lui-même). React Native : étapes 1 et 2 de la spec
/// Android (émulateur démarré au besoin sur `port`), puis Metro comme pour iOS.
pub fn react_native_android_command(
    target: &AppTarget,
    device: &AndroidDevice,
    sdk: &Path,
    port: u16,
) -> String {
    let base = target.scheme.as_deref().unwrap_or_default();
    let home = shell_quote(&sdk.to_string_lossy());
    if target.kind == AppKind::ReactNative {
        let (mut steps, serial) = boot_steps(device, sdk, port);
        steps.push(metro(base));
        steps.push(format!(
            "ANDROID_HOME={home} {base} --deviceId {serial} --no-packager"
        ));
        return format!("{}; fg", steps.join(" && "));
    }
    let name = device
        .serial
        .as_ref()
        .or(device.avd.as_ref())
        .unwrap_or(&device.id);
    format!("ANDROID_HOME={home} {base} --device {}", shell_quote(name))
}

/// Metro lancé en arrière-plan par l'exécuteur de la commande de base (son premier mot).
fn metro(base: &str) -> String {
    let runner = base.split_whitespace().next().unwrap_or("npx");
    format!("{{ {runner} react-native start & }}")
}
