//! SDK Android, appareils (émulateurs et branchés) et commande de lancement d'une app Gradle
//! (spec `apps-android.md`, décision 0021). Les outils du SDK sont appelés par leur chemin
//! absolu : le Finder donne à l'app un PATH réduit et pas les variables du shell.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::AppTarget;
use crate::process::run_with_timeout;
use crate::terminal::shell_quote;
use crate::{AppError, Failure};

/// Ports pairs de l'émulateur : sa série est `emulator-<port>`, le port impair suivant sert à adb.
const FIRST_PORT: u16 = 5554;
const LAST_PORT: u16 = 5584;
/// Délai d'un outil du SDK lu à l'ouverture du menu (adb démarre son démon s'il ne tourne pas).
const TOOL_TIMEOUT: Duration = Duration::from_secs(10);

/// Appareil Android du sélecteur (glossaire : `AndroidDevice`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDevice {
    /// Clé du choix gardé : nom de l'AVD d'un émulateur, sinon série.
    pub id: String,
    /// Nom affiché : AVD ou modèle, soulignés changés en espaces ; série à défaut.
    pub name: String,
    pub emulator: bool,
    pub avd: Option<String>,
    /// Série adb, présente si l'appareil est démarré ou branché.
    pub serial: Option<String>,
}

/// Appareil prêt de `adb devices -l`, avec l'AVD d'un émulateur démarré s'il est connu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    pub serial: String,
    /// Champ `model:` (`Pixel_7`).
    pub model: Option<String>,
    /// Lu par `adb -s <série> emu avd name` (émulateurs seulement).
    pub avd: Option<String>,
}

/// SDK de l'app : `ANDROID_HOME`, `ANDROID_SDK_ROOT`, puis l'emplacement d'Android Studio.
pub fn android_sdk() -> Option<PathBuf> {
    let var = |name: &str| env::var(name).ok();
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    find_android_sdk(
        var("ANDROID_HOME").as_deref(),
        var("ANDROID_SDK_ROOT").as_deref(),
        &home,
    )
}

/// Premier candidat qui contient le fichier `platform-tools/adb` : `android_home`, `sdk_root`,
/// puis `<home>/Library/Android/sdk`. Une valeur vide est sautée.
pub fn find_android_sdk(
    android_home: Option<&str>,
    sdk_root: Option<&str>,
    home: &Path,
) -> Option<PathBuf> {
    let from_var = |value: Option<&str>| value.filter(|v| !v.is_empty()).map(PathBuf::from);
    let default = (!home.as_os_str().is_empty()).then(|| home.join("Library/Android/sdk"));
    [from_var(android_home), from_var(sdk_root), default]
        .into_iter()
        .flatten()
        .find(|dir| dir.join("platform-tools").join("adb").is_file())
}

/// Appareils du SDK `sdk`, lus sans shell : `emulator -list-avds` (absent ou en échec : aucune
/// AVD), `adb devices -l` (en échec : erreur), puis `adb -s <série> emu avd name` pour chaque
/// émulateur démarré.
pub fn list_android_devices(sdk: &Path) -> Result<Vec<AndroidDevice>, AppError> {
    let avds = run_tool(&sdk.join("emulator").join("emulator"), &["-list-avds"])
        .map(|stdout| parse_avds(&stdout))
        .unwrap_or_default();
    let adb = sdk.join("platform-tools").join("adb");
    let stdout = run_tool(&adb, &["devices", "-l"])?;
    let mut connected = parse_adb_devices(&stdout);
    for device in connected
        .iter_mut()
        .filter(|d| d.serial.starts_with("emulator-"))
    {
        device.avd = run_tool(&adb, &["-s", &device.serial, "emu", "avd", "name"])
            .ok()
            .and_then(|stdout| parse_avd_name(&stdout));
    }
    Ok(merge_devices(&avds, &connected))
}

/// Sortie standard d'un outil lancé sans shell ; message d'erreur s'il manque, échoue ou dépasse
/// `TOOL_TIMEOUT`.
fn run_tool(program: &Path, args: &[&str]) -> Result<String, AppError> {
    let label = program
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    match run_with_timeout(command, None, TOOL_TIMEOUT) {
        Err(err) => Err(Failure::ToolNotFound {
            tool: label,
            error: err.to_string(),
        }
        .into()),
        Ok(None) => Err(Failure::ToolTimeout(label).into()),
        Ok(Some(out)) if !out.status.success() => Err(AppError::Io(format!(
            "{label}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))),
        Ok(Some(out)) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
    }
}

/// AVD de `emulator -list-avds` : une par ligne, sans les lignes vides ni celles qui contiennent
/// un espace (messages `INFO |`).
pub fn parse_avds(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.contains(char::is_whitespace))
        .map(str::to_owned)
        .collect()
}

/// Appareils à l'état `device` de `adb devices -l` (`unauthorized`, `offline`, en-tête et
/// messages du démon ignorés).
pub fn parse_adb_devices(stdout: &str) -> Vec<AdbDevice> {
    stdout
        .lines()
        .filter_map(|line| {
            let words: Vec<&str> = line.split_whitespace().collect();
            let (serial, state) = (words.first()?, words.get(1)?);
            (*state == "device").then(|| AdbDevice {
                serial: (*serial).to_owned(),
                model: words
                    .iter()
                    .find_map(|w| w.strip_prefix("model:"))
                    .map(str::to_owned),
                avd: None,
            })
        })
        .collect()
}

/// Nom d'AVD de `adb emu avd name` : première ligne non vide, sauf le `OK` final.
pub fn parse_avd_name(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .filter(|line| *line != "OK")
        .map(str::to_owned)
}

/// Liste du sélecteur : appareils branchés et émulateurs démarrés (un émulateur démarré
/// remplace son AVD), puis AVD arrêtées. Démarrés d'abord, puis par nom.
pub fn merge_devices(avds: &[String], connected: &[AdbDevice]) -> Vec<AndroidDevice> {
    let mut devices: Vec<AndroidDevice> = connected
        .iter()
        .map(|d| AndroidDevice {
            id: d.avd.clone().unwrap_or_else(|| d.serial.clone()),
            name: d
                .avd
                .as_ref()
                .or(d.model.as_ref())
                .map_or_else(|| d.serial.clone(), |label| label.replace('_', " ")),
            emulator: d.serial.starts_with("emulator-"),
            avd: d.avd.clone(),
            serial: Some(d.serial.clone()),
        })
        .collect();
    for avd in avds {
        if !connected.iter().any(|d| d.avd.as_ref() == Some(avd)) {
            devices.push(AndroidDevice {
                id: avd.clone(),
                name: avd.replace('_', " "),
                emulator: true,
                avd: Some(avd.clone()),
                serial: None,
            });
        }
    }
    devices.sort_by(|a, b| (a.serial.is_none(), &a.name).cmp(&(b.serial.is_none(), &b.name)));
    devices
}

/// Premier port pair libre de 5554 à 5584 (aucune série `emulator-<port>`). Tous pris : 5554
/// (l'émulateur refuse alors de démarrer, son message reste dans la page).
pub fn free_emulator_port(devices: &[AndroidDevice]) -> u16 {
    (FIRST_PORT..=LAST_PORT)
        .step_by(2)
        .find(|port| {
            let serial = format!("emulator-{port}");
            !devices
                .iter()
                .any(|d| d.serial.as_deref() == Some(serial.as_str()))
        })
        .unwrap_or(FIRST_PORT)
}

/// Commande sh/zsh qui compile, installe et lance le module `target.scheme` du projet Gradle
/// `target.project` sur `device`, puis suit ses journaux au premier plan. Tapée dans le dossier
/// du projet. Étapes enchaînées par `&&` : un échec (compilation, installation) arrête la suite.
pub fn android_command(
    target: &AppTarget,
    device: &AndroidDevice,
    sdk: &Path,
    port: u16,
) -> String {
    let (mut steps, serial) = boot_steps(device, sdk, port);
    let adb = tool(sdk, "platform-tools/adb");
    let module = target.scheme.as_deref().unwrap_or(":app");
    let module_dir = module.trim_start_matches(':').replace(':', "/");
    let project = target.project.as_deref().unwrap_or_default();
    let gradle = if Path::new(project).join("gradlew").is_file() {
        "./gradlew"
    } else {
        "gradle"
    };
    steps.push(format!(
        "ANDROID_HOME={} ANDROID_SERIAL={serial} {gradle} {}",
        shell_quote(&sdk.to_string_lossy()),
        shell_quote(&format!("{module}:installDebug")),
    ));
    steps.push(format!(
        "APK=$(command ls -t {}/build/outputs/apk/debug/*.apk | head -1)",
        shell_quote(&module_dir),
    ));
    steps.push(format!("PKG=$({} dump packagename \"$APK\")", aapt2(sdk)));
    steps.push(format!(
        "ACT=$({adb} -s {serial} shell cmd package resolve-activity --brief \
         -c android.intent.category.LAUNCHER \"$PKG\" | tail -1 | tr -d '\\r')"
    ));
    steps.push(format!("{adb} -s {serial} shell am start -W -n \"$ACT\""));
    steps.push(format!(
        "{adb} -s {serial} logcat --pid=\"$({adb} -s {serial} shell pidof -s \"$PKG\" | tr -d '\\r')\""
    ));
    steps.join(" && ")
}

/// Étapes 1 et 2 de la spec, partagées avec React Native : démarrage détaché de l'émulateur
/// arrêté sur `port` (sa série devient `emulator-<port>`), puis attente de l'appareil et de
/// `sys.boot_completed`. Rend les étapes et la série, citée pour le shell.
pub(super) fn boot_steps(device: &AndroidDevice, sdk: &Path, port: u16) -> (Vec<String>, String) {
    let adb = tool(sdk, "platform-tools/adb");
    let mut steps = Vec::new();
    let serial = match (&device.serial, &device.avd) {
        (Some(serial), _) => serial.clone(),
        (None, Some(avd)) => {
            steps.push(format!(
                "( {} -avd {} -port {port} >/dev/null 2>&1 & )",
                tool(sdk, "emulator/emulator"),
                shell_quote(avd),
            ));
            format!("emulator-{port}")
        }
        (None, None) => device.id.clone(),
    };
    let serial = shell_quote(&serial);
    steps.push(format!("{adb} -s {serial} wait-for-device"));
    steps.push(format!(
        "until [ \"$({adb} -s {serial} shell getprop sys.boot_completed | tr -d '\\r')\" = 1 ]; \
         do sleep 1; done"
    ));
    (steps, serial)
}

/// Chemin d'un outil du SDK, cité pour le shell.
fn tool(sdk: &Path, rel: &str) -> String {
    shell_quote(&sdk.join(rel).to_string_lossy())
}

/// `aapt2` de la version la plus récente de `<sdk>/build-tools` (versions comparées en nombres),
/// cité ; aucun : celui du PATH.
fn aapt2(sdk: &Path) -> String {
    fs::read_dir(sdk.join("build-tools"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|dir| dir.join("aapt2").is_file())
        .max_by_key(|dir| version_key(dir))
        .map_or_else(
            || "aapt2".to_owned(),
            |dir| shell_quote(&dir.join("aapt2").to_string_lossy()),
        )
}

/// Nombres d'un nom de version (`36.1.0` → `[36, 1, 0]`, `35.0.0-rc1` → `[35, 0, 0]`).
fn version_key(dir: &Path) -> Vec<u32> {
    dir.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}
