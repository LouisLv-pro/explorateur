//! Simulateurs disponibles (iOS, watchOS, tvOS, visionOS), lus dans la sortie de
//! `xcrun simctl list devices available -j`.

use std::cmp::Reverse;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{AppError, Failure};

const RUNTIME_PREFIX: &str = "com.apple.CoreSimulator.SimRuntime.";

/// Plateforme d'un simulateur, d'après le nom de son runtime. `xrOS` et `visionOS` sont deux
/// noms de la même plateforme selon la version d'Xcode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SimPlatform {
    Ios,
    Watchos,
    Tvos,
    Visionos,
}

/// Préfixes de runtime reconnus ; les autres runtimes sont ignorés.
const RUNTIMES: [(&str, SimPlatform); 5] = [
    ("iOS-", SimPlatform::Ios),
    ("watchOS-", SimPlatform::Watchos),
    ("tvOS-", SimPlatform::Tvos),
    ("xrOS-", SimPlatform::Visionos),
    ("visionOS-", SimPlatform::Visionos),
];

/// Appareil simulé (glossaire : `Simulator`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Simulator {
    /// UDID, passé à `-destination id=…` et à `simctl`.
    pub id: String,
    pub name: String,
    /// Version du système, `"27.0"`.
    pub os_version: String,
    pub booted: bool,
    pub platform: SimPlatform,
}

/// `xcrun` par son chemin absolu : le Finder donne à l'app un PATH réduit.
const XCRUN: &str = "/usr/bin/xcrun";

/// Simulateurs iOS (voir `run_simctl`).
pub fn list_simulators() -> Result<Vec<Simulator>, AppError> {
    parse_simulators(&run_simctl()?)
}

/// Simulateurs de toutes les plateformes (voir `run_simctl`).
pub fn list_all_simulators() -> Result<Vec<Simulator>, AppError> {
    parse_all_simulators(&run_simctl()?)
}

/// Lance `xcrun simctl list devices available -j` (sans shell, bloquant) et rend sa sortie.
/// Xcode absent ou `simctl` en échec : erreur.
fn run_simctl() -> Result<String, AppError> {
    let output = Command::new(XCRUN)
        .args(["simctl", "list", "devices", "available", "-j"])
        .output()
        .map_err(|e| Failure::ToolNotFound {
            tool: "xcrun".to_owned(),
            error: e.to_string(),
        })?;
    if !output.status.success() {
        return Err(AppError::Io(format!(
            "simctl: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Simulateurs iOS de la sortie JSON de `simctl`, dans l'ordre de `parse_all_simulators`.
pub fn parse_simulators(json: &str) -> Result<Vec<Simulator>, AppError> {
    let mut sims = parse_all_simulators(json)?;
    sims.retain(|sim| sim.platform == SimPlatform::Ios);
    Ok(sims)
}

/// Simulateurs de toutes les plateformes de la sortie JSON de `simctl`, dans l'ordre du menu :
/// démarrés d'abord, puis système le plus récent (versions comparées comme des nombres), iPhone
/// avant iPad, puis nom. JSON invalide : erreur.
pub fn parse_all_simulators(json: &str) -> Result<Vec<Simulator>, AppError> {
    let unreadable = |error: String| Failure::UnreadableOutput {
        tool: "simctl".to_owned(),
        error,
    };
    let value: Value = serde_json::from_str(json).map_err(|err| unreadable(err.to_string()))?;
    let runtimes = value
        .get("devices")
        .and_then(Value::as_object)
        .ok_or_else(|| unreadable(String::new()))?;

    let mut sims: Vec<(Vec<u32>, Simulator)> = Vec::new();
    for (runtime, devices) in runtimes {
        let Some((version, platform)) = runtime.strip_prefix(RUNTIME_PREFIX).and_then(|name| {
            RUNTIMES
                .iter()
                .find_map(|(prefix, platform)| Some((name.strip_prefix(prefix)?, *platform)))
        }) else {
            continue;
        };
        let numbers: Vec<u32> = version.split('-').filter_map(|n| n.parse().ok()).collect();
        let os_version = version.replace('-', ".");
        for device in devices.as_array().into_iter().flatten() {
            let text = |key: &str| device.get(key).and_then(Value::as_str);
            if device.get("isAvailable").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let (Some(id), Some(name)) = (text("udid"), text("name")) else {
                continue;
            };
            sims.push((
                numbers.clone(),
                Simulator {
                    id: id.to_owned(),
                    name: name.to_owned(),
                    os_version: os_version.clone(),
                    booted: text("state") == Some("Booted"),
                    platform,
                },
            ));
        }
    }
    sims.sort_by(|(va, a), (vb, b)| {
        let key = |v: &Vec<u32>, s: &Simulator| {
            (
                Reverse(s.booted),
                Reverse(v.clone()),
                !s.name.starts_with("iPhone"),
                s.name.clone(),
            )
        };
        key(va, a).cmp(&key(vb, b))
    });
    Ok(sims.into_iter().map(|(_, sim)| sim).collect())
}
