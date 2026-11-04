//! Commande de lancement d'une app Xcode, tapée dans une page du terminal (décision 0009) :
//! compilation par `xcodebuild`, puis installation et lancement dans le Simulateur (iOS,
//! watchOS, tvOS, visionOS) ou exécutable de l'`.app` au premier plan (macOS, Mac Catalyst),
//! enchaînés par `&&`.

use std::path::Path;

use super::{AppKind, AppTarget};
use crate::terminal::shell_quote;

/// Appareil visé par `simctl` quand aucun simulateur n'est choisi : celui qui est démarré.
const BOOTED: &str = "booted";
/// Device Hub : remplace l'app Simulator depuis Xcode 27 (elle n'y existe plus).
const DEVICE_HUB: &str = "com.apple.dt.Devices";

/// Commande sh/zsh qui compile et lance la cible Xcode `target`. `simulator_id` : simulateur
/// choisi (ignoré pour macOS et Mac Catalyst) ; `cache_root` : dossier cache de l'app, qui reçoit
/// `DerivedData/<empreinte>`. `command ls` évite un alias de `ls` dans le shell de l'utilisateur.
pub fn xcode_command(target: &AppTarget, simulator_id: Option<&str>, cache_root: &Path) -> String {
    let project = target.project.as_deref().unwrap_or_default();
    let flag = if project.ends_with(".xcworkspace") {
        "-workspace"
    } else {
        "-project"
    };
    let scheme = target.scheme.as_deref().unwrap_or_default();
    let derived = cache_root
        .join("DerivedData")
        .join(fingerprint(project))
        .to_string_lossy()
        .into_owned();
    let dd = shell_quote(&derived);
    let build = |destination: &str| {
        format!(
            "xcodebuild {flag} {} -scheme {} -configuration Debug -destination {} \
             -derivedDataPath {dd} build",
            shell_quote(project),
            shell_quote(scheme),
            shell_quote(destination),
        )
    };

    match target.kind.simulator_sdk() {
        Some(sdk) => simulator_chain(target.kind, sdk, simulator_id, &dd, &build),
        None => {
            // Mac Catalyst s'exécute comme une app macOS, avec son propre dossier de produits.
            let (destination, products) = if target.kind == AppKind::Catalyst {
                ("platform=macOS,variant=Mac Catalyst", "Debug-maccatalyst")
            } else {
                ("platform=macOS", "Debug")
            };
            executable_chain(destination, products, &dd, &build)
        }
    }
}

/// Compile pour le Mac puis lance l'exécutable de l'`.app` au premier plan.
fn executable_chain(
    destination: &str,
    products: &str,
    dd: &str,
    build: &dyn Fn(&str) -> String,
) -> String {
    format!(
        "{} && APP=$(command ls -d {dd}/Build/Products/{products}/*.app | head -1) && \
         \"$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
         \"$APP/Contents/Info.plist\")\"",
        build(destination),
    )
}

/// Compile pour un simulateur (`kind` : sa plateforme, `sdk` : son SDK, qui nomme le dossier
/// de produits), l'installe puis le lance sur `simulator_id`, ou sur le simulateur démarré.
fn simulator_chain(
    kind: AppKind,
    sdk: &str,
    simulator_id: Option<&str>,
    dd: &str,
    build: &dyn Fn(&str) -> String,
) -> String {
    let (destination, device) = match simulator_id {
        Some(id) => (format!("id={id}"), shell_quote(id)),
        None => (
            format!("generic/platform={} Simulator", kind.platform_name()),
            BOOTED.to_owned(),
        ),
    };
    format!(
        "{} && xcrun simctl bootstatus {device} -b && {{ open -a Simulator 2>/dev/null || \
         open -b {DEVICE_HUB} 2>/dev/null || true; }} && \
         APP=$(command ls -d {dd}/Build/Products/Debug-{sdk}/*.app | head -1) && \
         xcrun simctl install {device} \"$APP\" && \
         xcrun simctl launch --console-pty --terminate-running-process {device} \
         \"$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \"$APP/Info.plist\")\"",
        build(&destination),
    )
}

/// Dossier de cache d'un projet : nom du projet (lisible dans le Finder) et empreinte FNV-1a
/// de son chemin, stable d'une version de l'app à l'autre (contrairement au hachage de `std`).
fn fingerprint(project: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in project.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    let stem: String = Path::new(project)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if stem.is_empty() {
        format!("{hash:016x}")
    } else {
        format!("{stem}-{hash:016x}")
    }
}
