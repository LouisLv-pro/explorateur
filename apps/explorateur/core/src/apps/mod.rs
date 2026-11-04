//! Apps natives du dossier racine (specs `apps-natives.md`, `apps-android.md`,
//! `apps-react-native.md`, `apps-flutter.md`, décisions 0009, 0020, 0021 et 0022) : projets
//! Xcode (iOS, watchOS, tvOS, visionOS, macOS, Mac Catalyst), projets Gradle d'app Android,
//! paquets Expo et React Native, apps Flutter (`flutter.rs`) et scripts `tauri dev`, détectés à
//! la demande avec le parcours des serveurs, lancés dans une page du terminal.

mod android;
mod command;
mod electron;
mod flutter;
mod gradle;
mod react_native;
mod rust;
mod simulators;
mod swift;
mod xcode;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::Git;
use crate::servers::{
    ignored_paths, package_manager, read_package, relative_dir, scan, sorted_package_dirs,
};

pub use android::{
    AdbDevice, AndroidDevice, android_command, android_sdk, find_android_sdk, free_emulator_port,
    list_android_devices, merge_devices, parse_adb_devices, parse_avd_name, parse_avds,
};
pub use command::xcode_command;
pub(crate) use electron::electron_script;
pub use flutter::{
    FlutterApp, FlutterDevice, FlutterDeviceCache, FlutterDevices, FlutterPlatform,
    compatible_devices, detect_flutter_apps, find_flutter, find_flutter_in, flutter_command,
    list_flutter_devices, parse_flutter_devices,
};
pub use react_native::{react_native_android_command, react_native_ios_command};
pub use simulators::{
    SimPlatform, Simulator, list_all_simulators, list_simulators, parse_all_simulators,
    parse_simulators,
};

/// Règle du bruit (spec `apps-commandes.md`, décision 0023), pour garder les menus courts.
/// Dossiers dont la présence dans le chemin relatif d'un manifeste écarte l'app (casse ignorée,
/// nom entier). Le dossier racine n'est pas jugé.
const EXCLUDED_DIRS: [&str; 11] = [
    "examples",
    "example",
    "benches",
    "benchmarks",
    "tests",
    "fixtures",
    "templates",
    "vendor",
    "third_party",
    "Pods",
    "Carthage",
];
/// Apps au plus par package (Rust et Swift).
const MAX_PER_PACKAGE: usize = 4;
/// Apps au plus par genre (Rust et Swift). Les apps Electron n'ont pas de plafond.
const MAX_PER_KIND: usize = 12;

/// Genre d'app native : plateforme d'une app Xcode, fenêtre Tauri ou Electron, binaire Rust
/// (`cargo run`), exécutable d'un paquet Swift (`swift run`), app Android (Gradle), app Flutter
/// (`flutter run`), ou cible d'un paquet Expo ou React Native (sa plateforme est sa source
/// d'appareils).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    Ios,
    Watchos,
    Tvos,
    Visionos,
    Macos,
    /// iOS exécuté sur le Mac (`SUPPORTS_MACCATALYST = YES`).
    Catalyst,
    Tauri,
    Electron,
    Rust,
    Swift,
    Flutter,
    Android,
    Expo,
    ReactNative,
}

impl AppKind {
    /// Plateformes lancées dans un simulateur : leur SDK de simulateur. Il nomme le dossier de
    /// produits (`Debug-<sdk>`), `xros` compris (et non `visionos`). Les autres genres : aucun.
    fn simulator_sdk(self) -> Option<&'static str> {
        match self {
            Self::Ios => Some("iphonesimulator"),
            Self::Watchos => Some("watchsimulator"),
            Self::Tvos => Some("appletvsimulator"),
            Self::Visionos => Some("xrsimulator"),
            Self::Macos
            | Self::Catalyst
            | Self::Tauri
            | Self::Electron
            | Self::Rust
            | Self::Swift
            | Self::Flutter
            | Self::Android
            | Self::Expo
            | Self::ReactNative => None,
        }
    }

    /// Nom de la plateforme, pour la destination générique `generic/platform=<nom> Simulator`.
    fn platform_name(self) -> &'static str {
        match self {
            Self::Ios => "iOS",
            Self::Watchos => "watchOS",
            Self::Tvos => "tvOS",
            Self::Visionos => "visionOS",
            Self::Macos => "macOS",
            Self::Catalyst => "Mac Catalyst",
            Self::Tauri => "Tauri",
            Self::Electron => "Electron",
            Self::Rust => "Rust",
            Self::Swift => "Swift",
            Self::Flutter => "Flutter",
            Self::Android => "Android",
            Self::Expo => "Expo",
            Self::ReactNative => "React Native",
        }
    }
}

/// Source des appareils sur lesquels une cible se lance (décision 0020) : la ligne du menu
/// porte alors un sélecteur d'appareil.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DeviceSource {
    /// Simulateurs iOS (`xcrun simctl`).
    IosSimulators,
    /// Appareils de `flutter devices` compatibles avec l'app (`list_flutter_devices`).
    FlutterDevices,
    /// Simulateurs de montre.
    WatchosSimulators,
    /// Simulateurs d'Apple TV.
    TvosSimulators,
    /// Simulateurs de Vision Pro.
    VisionosSimulators,
    /// Émulateurs et appareils Android branchés (`emulator -list-avds`, `adb devices`).
    AndroidDevices,
}

/// App native détectée, une ligne du menu (glossaire : `NativeApp`, décision 0020).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeApp {
    /// Schéma Xcode (« Demo ») ou nom du paquet (« explorateur »).
    pub name: String,
    /// Dossier de lancement, absolu : celui qui contient le projet Xcode, ou du `package.json`.
    pub dir: String,
    /// Sous-titre : chemin du projet Xcode relatif au dossier racine (`ios/Demo.xcodeproj`),
    /// ou dossier du `package.json` (`.` pour la racine). `/` comme séparateur.
    pub relative_dir: String,
    /// Façons de lancer l'app, dans un ordre fixe par genre (iOS puis macOS ; `tauri` puis
    /// les autres scripts par nom).
    pub targets: Vec<AppTarget>,
}

/// Cible d'une app : une façon de la lancer (glossaire : `AppTarget`). Porte son propre état
/// dans le front (page de terminal, En cours).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppTarget {
    /// Stable et unique dans l'app : « ios », « macos », « script:<nom> ».
    pub id: String,
    /// « iOS », « macOS », « tauri dev », « desktop ».
    pub label: String,
    pub kind: AppKind,
    /// Appareils proposés par le sélecteur ; `None` : pas de sélecteur.
    pub device_source: Option<DeviceSource>,
    /// Chemin absolu du `.xcodeproj` ou `.xcworkspace` (Xcode), ou dossier du projet Gradle.
    pub project: Option<String>,
    /// Schéma Xcode, chemin Gradle du module d'application (`:app`), ou commande de base
    /// d'Expo et de React Native (`pnpm expo run:ios`).
    pub scheme: Option<String>,
    /// Commande fixe (Tauri) ; `None` : construite par `get_app_command` selon `kind`.
    pub command: Option<String>,
}

/// Apps natives de `root` : Xcode, Android (Gradle), Expo et React Native, puis Tauri, chaque
/// groupe trié par `relative_dir` puis `name`. Les projets Xcode de `<paquet>/ios/` et le projet
/// Gradle de `<paquet>/android` d'un paquet Expo ou React Native sont les siens : ils ne donnent
/// pas d'app de plus. Il en va de même pour les dossiers `ios/`, `macos/` et `android/` d'une
/// app Flutter : l'app Flutter est leur porte d'entrée. Infaillible : un fichier illisible est
/// ignoré.
pub fn detect_apps(root: &Path) -> Vec<NativeApp> {
    detect_with(root, &HashSet::new())
}

/// Comme `detect_apps`, mais dans un dépôt git les dossiers ignorés par git ne sont pas
/// parcourus (un paquet Xcode ignoré est gardé). Hors dépôt ou git absent : `detect_apps`.
pub fn detect_apps_git(git: &Git, root: &Path) -> Vec<NativeApp> {
    detect_with(root, &ignored_paths(git, &root.to_string_lossy()))
}

fn detect_with(root: &Path, ignored: &HashSet<String>) -> Vec<NativeApp> {
    let found = scan(root, ignored);
    let flutter = flutter::flutter_apps(root, &found.pubspec_dirs);
    let mobile: Vec<(PathBuf, String, react_native::Framework)> = found
        .package_dirs
        .iter()
        .filter_map(|dir| {
            let (name, framework) = react_native::read_framework(dir)?;
            Some((dir.clone(), name, framework))
        })
        .collect();
    let bundles: Vec<PathBuf> = found
        .xcode_bundles
        .iter()
        .filter(|bundle| {
            !mobile
                .iter()
                .any(|(dir, ..)| bundle.parent() == Some(dir.join("ios").as_path()))
                && !flutter.iter().any(|app| app.owns(bundle))
        })
        .cloned()
        .collect();
    let gradle_dirs: Vec<PathBuf> = found
        .gradle_dirs
        .into_iter()
        .filter(|gradle| {
            !mobile
                .iter()
                .any(|(dir, ..)| *gradle == dir.join("android"))
                && !flutter.iter().any(|app| app.owns(gradle))
        })
        .collect();

    let mut apps = xcode::xcode_apps(root, &bundles);
    sort(&mut apps);
    let mut android = gradle::gradle_apps(root, &gradle_dirs);
    sort(&mut android);
    apps.extend(android);
    let mut mobile_apps: Vec<NativeApp> = mobile
        .iter()
        .map(|(dir, name, framework)| react_native::package_app(root, dir, name, *framework))
        .collect();
    sort(&mut mobile_apps);
    apps.extend(mobile_apps);

    let packages = sorted_package_dirs(root, found.package_dirs);

    let mut tauri: Vec<NativeApp> = packages
        .iter()
        .filter_map(|(rel, dir)| tauri_apps(root, dir, rel))
        .collect();
    sort(&mut tauri);
    apps.extend(tauri);

    let mut electron: Vec<NativeApp> = packages
        .iter()
        .filter(|(rel, _)| !in_excluded_dir(rel))
        .filter_map(|(rel, dir)| electron::electron_app(root, dir, rel))
        .collect();
    sort(&mut electron);
    apps.extend(electron);

    let mut rust: Vec<NativeApp> = found
        .cargo_dirs
        .iter()
        .map(|dir| (relative_dir(root, dir), dir))
        .filter(|(rel, _)| !in_excluded_dir(rel))
        .flat_map(|(rel, dir)| rust::rust_apps(dir, &rel))
        .collect();
    sort(&mut rust);
    rust.truncate(MAX_PER_KIND);
    apps.extend(rust);

    // Un dossier qui contient aussi un projet Xcode est déjà couvert par l'app Xcode.
    let xcode_dirs: HashSet<&Path> = found
        .xcode_bundles
        .iter()
        .filter_map(|bundle| bundle.parent())
        .collect();
    let mut swift: Vec<NativeApp> = found
        .swift_dirs
        .iter()
        .filter(|dir| !xcode_dirs.contains(dir.as_path()))
        .map(|dir| (relative_dir(root, dir), dir))
        .filter(|(rel, _)| !in_excluded_dir(rel))
        .flat_map(|(rel, dir)| swift::swift_apps(dir, &rel))
        .collect();
    sort(&mut swift);
    swift.truncate(MAX_PER_KIND);
    apps.extend(swift);

    // Flutter en dernier : ses dossiers `ios/` et `macos/` ont déjà été écartés de Xcode.
    apps.extend(flutter.iter().map(flutter::native_app));
    apps
}

/// App à une seule cible, lancée par une commande fixe (Electron, Rust, Swift) : pas de
/// sélecteur d'appareil.
fn command_app(
    name: &str,
    dir: &Path,
    relative_dir: &str,
    target: (&str, &str, AppKind),
    command: String,
) -> NativeApp {
    let (id, label, kind) = target;
    NativeApp {
        name: name.to_owned(),
        dir: dir.to_string_lossy().into_owned(),
        relative_dir: relative_dir.to_owned(),
        targets: vec![AppTarget {
            id: id.to_owned(),
            label: label.to_owned(),
            kind,
            device_source: None,
            project: None,
            scheme: None,
            command: Some(command),
        }],
    }
}

/// Vrai si `path` (relatif, `/` comme séparateur) contient un dossier de `EXCLUDED_DIRS`.
fn in_excluded_dir(path: &str) -> bool {
    path.split(['/', '\\']).any(|part| {
        EXCLUDED_DIRS
            .iter()
            .any(|excluded| part.eq_ignore_ascii_case(excluded))
    })
}

/// Plafond de `MAX_PER_PACKAGE` apps pour un package : on garde les premières selon `key`
/// (priorité, plus petite d'abord, puis nom).
fn cap_per_package<T>(mut items: Vec<T>, key: impl Fn(&T) -> (u8, String)) -> Vec<T> {
    items.sort_by_key(key);
    items.truncate(MAX_PER_PACKAGE);
    items
}

fn sort(apps: &mut [NativeApp]) {
    apps.sort_by(|a, b| (&a.relative_dir, &a.name).cmp(&(&b.relative_dir, &b.name)));
}

/// App Tauri d'un `package.json`, s'il a au moins un script Tauri : une cible par script
/// reconnu, `tauri` d'abord (lancé en `run tauri dev`, libellé « tauri dev »), puis par nom les
/// scripts dont la commande commence par `tauri dev` (lancés et libellés par leur nom).
fn tauri_apps(root: &Path, dir: &Path, relative_dir: &str) -> Option<NativeApp> {
    let (name, scripts) = read_package(dir)?;
    let manager = package_manager(root, dir);
    let mut targets: Vec<AppTarget> = scripts
        .iter()
        .filter_map(|(script, text)| {
            let text = text.as_str()?;
            let (label, command) = if script == "tauri" {
                ("tauri dev".to_owned(), format!("{manager} run tauri dev"))
            } else if text == "tauri dev" || text.starts_with("tauri dev ") {
                (script.clone(), format!("{manager} run {script}"))
            } else {
                return None;
            };
            Some(AppTarget {
                id: format!("script:{script}"),
                label,
                kind: AppKind::Tauri,
                device_source: None,
                project: None,
                scheme: None,
                command: Some(command),
            })
        })
        .collect();
    if targets.is_empty() {
        return None;
    }
    targets.sort_by_key(|t| (t.id != "script:tauri", t.id.clone()));
    Some(NativeApp {
        name,
        dir: dir.to_string_lossy().into_owned(),
        relative_dir: relative_dir.to_owned(),
        targets,
    })
}
