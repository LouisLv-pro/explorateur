//! Apps Flutter (spec `apps-flutter.md`, décision 0022) : détection par le texte de
//! `pubspec.yaml` (sans crate YAML), appareils lus dans `flutter devices --machine`, recherche
//! de l'exécutable `flutter` et commande de lancement.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{AppKind, AppTarget, DeviceSource, NativeApp};
use crate::servers::relative_dir;
use crate::terminal::shell_quote;
use crate::{AppError, Failure};

/// Plateformes d'une app Flutter, dans l'ordre d'affichage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FlutterPlatform {
    Ios,
    Android,
    Macos,
    Web,
    Linux,
    Windows,
}

/// Dossier de chaque plateforme, dans l'ordre d'affichage.
const PLATFORM_DIRS: [(&str, FlutterPlatform); 6] = [
    ("ios", FlutterPlatform::Ios),
    ("android", FlutterPlatform::Android),
    ("macos", FlutterPlatform::Macos),
    ("web", FlutterPlatform::Web),
    ("linux", FlutterPlatform::Linux),
    ("windows", FlutterPlatform::Windows),
];

/// Dossiers générés par Flutter que l'app revendique (Xcode, Gradle).
const OWNED_DIRS: [&str; 3] = ["ios", "macos", "android"];

/// App Flutter détectée (glossaire : `FlutterApp`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlutterApp {
    /// Champ `name` du `pubspec.yaml`, sinon nom du dossier.
    pub name: String,
    /// Dossier de l'app (celui du `pubspec.yaml`), absolu : dossier de lancement.
    pub dir: String,
    /// Sous-titre : `dir` relatif au dossier racine (`.` pour la racine), `/` comme séparateur.
    pub relative_dir: String,
    /// Dossiers de plateforme présents, dans l'ordre de `PLATFORM_DIRS`.
    pub platforms: Vec<FlutterPlatform>,
}

impl FlutterApp {
    /// Vrai si `path` est `ios`, `macos` ou `android` de l'app, ou en dépend. Comparaison par
    /// composants de chemin : `ios-extra` et un autre dossier `ios` ne sont pas revendiqués.
    pub fn owns(&self, path: &Path) -> bool {
        let Ok(rest) = path.strip_prefix(&self.dir) else {
            return false;
        };
        match rest.components().next() {
            Some(Component::Normal(first)) => OWNED_DIRS.iter().any(|d| first == OsStr::new(d)),
            _ => false,
        }
    }
}

/// Apps Flutter de `root`, triées par `relative_dir` puis `name`. Infaillible : un
/// `pubspec.yaml` illisible est ignoré.
pub fn detect_flutter_apps(root: &Path) -> Vec<FlutterApp> {
    flutter_apps(
        root,
        &crate::servers::scan(root, &std::collections::HashSet::new()).pubspec_dirs,
    )
}

/// Apps Flutter des dossiers de `pubspec.yaml` déjà trouvés par le parcours.
pub(super) fn flutter_apps(root: &Path, pubspec_dirs: &[PathBuf]) -> Vec<FlutterApp> {
    let mut apps: Vec<FlutterApp> = pubspec_dirs
        .iter()
        .filter_map(|dir| flutter_app(root, dir))
        .collect();
    apps.sort_by(|a, b| (&a.relative_dir, &a.name).cmp(&(&b.relative_dir, &b.name)));
    apps
}

/// App Flutter de `dir`, si son `pubspec.yaml` en déclare une et que `lib/main.dart` existe.
fn flutter_app(root: &Path, dir: &Path) -> Option<FlutterApp> {
    let text = fs::read_to_string(dir.join("pubspec.yaml")).ok()?;
    let pubspec = read_pubspec(&text);
    if !pubspec.uses_flutter || !dir.join("lib").join("main.dart").is_file() {
        return None;
    }
    let name = pubspec.name.unwrap_or_else(|| {
        dir.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    });
    Some(FlutterApp {
        name,
        dir: dir.to_string_lossy().into_owned(),
        relative_dir: relative_dir(root, dir),
        platforms: platforms_in(dir),
    })
}

/// Plateformes d'une app : ses dossiers `ios`, `android`... présents, dans l'ordre d'affichage.
fn platforms_in(dir: &Path) -> Vec<FlutterPlatform> {
    PLATFORM_DIRS
        .iter()
        .filter(|(folder, _)| dir.join(folder).is_dir())
        .map(|(_, platform)| *platform)
        .collect()
}

/// L'app Flutter vue par le menu des apps (décision 0020) : une cible `flutter`, avec le
/// sélecteur des appareils Flutter ; la commande dépend de l'appareil (`flutter_command`).
pub(super) fn native_app(app: &FlutterApp) -> NativeApp {
    NativeApp {
        name: app.name.clone(),
        dir: app.dir.clone(),
        relative_dir: app.relative_dir.clone(),
        targets: vec![AppTarget {
            id: "flutter".to_owned(),
            label: "Flutter".to_owned(),
            kind: AppKind::Flutter,
            device_source: Some(DeviceSource::FlutterDevices),
            project: None,
            scheme: None,
            command: None,
        }],
    }
}

/// Ce qu'on lit d'un `pubspec.yaml`.
struct Pubspec {
    /// `name:` de premier niveau, s'il n'est pas vide.
    name: Option<String>,
    /// `dependencies:` contient `flutter` avec `sdk: flutter`.
    uses_flutter: bool,
}

/// Lecture ligne à ligne : pas de crate YAML pour deux clés (décision 0022). Un `pubspec.yaml`
/// exotique (ancres, fusion de clés) n'est pas reconnu.
fn read_pubspec(text: &str) -> Pubspec {
    // (indentation, contenu sans commentaire), sans les lignes vides.
    let lines: Vec<(usize, String)> = text
        .lines()
        .filter_map(|raw| {
            let line = strip_comment(raw);
            let content = line.trim();
            (!content.is_empty())
                .then(|| (line.len() - line.trim_start().len(), content.to_owned()))
        })
        .collect();

    let mut name = None;
    let mut uses_flutter = false;
    let mut i = 0;
    while i < lines.len() {
        let (indent, content) = &lines[i];
        i += 1;
        if *indent != 0 {
            continue;
        }
        let Some((key, value)) = split_key(content) else {
            continue;
        };
        if key == "name" && name.is_none() && !value.is_empty() {
            name = Some(value);
        } else if key == "dependencies" {
            let block_end = lines[i..]
                .iter()
                .position(|(indent, _)| *indent == 0)
                .map_or(lines.len(), |n| i + n);
            uses_flutter = uses_flutter || block_declares_flutter(&lines[i..block_end]);
        }
    }
    Pubspec { name, uses_flutter }
}

/// Le bloc `dependencies` (lignes indentées) déclare-t-il `flutter` avec `sdk: flutter` ?
fn block_declares_flutter(block: &[(usize, String)]) -> bool {
    let Some((entry_indent, _)) = block.first() else {
        return false;
    };
    for (index, (indent, content)) in block.iter().enumerate() {
        if indent != entry_indent {
            continue;
        }
        let Some((key, value)) = split_key(content) else {
            continue;
        };
        if key != "flutter" {
            continue;
        }
        if value.starts_with('{') {
            return inline_sdk_is_flutter(&value);
        }
        if value.is_empty() {
            return block[index + 1..]
                .iter()
                .take_while(|(indent, _)| indent > entry_indent)
                .filter_map(|(_, content)| split_key(content))
                .any(|(key, value)| key == "sdk" && value == "flutter");
        }
    }
    false
}

/// `{sdk: flutter}` : forme en ligne de l'entrée.
fn inline_sdk_is_flutter(value: &str) -> bool {
    let inner = value.trim_start_matches('{');
    let inner = inner.split('}').next().unwrap_or_default();
    inner
        .split(',')
        .filter_map(|pair| split_key(pair.trim()))
        .any(|(key, value)| key == "sdk" && value == "flutter")
}

/// `clé: valeur` en YAML : le premier `:` suivi d'une espace ou de la fin. Clé et valeur sont
/// rendues sans guillemets.
fn split_key(content: &str) -> Option<(String, String)> {
    let mut chars = content.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if c == ':' && chars.peek().is_none_or(|(_, next)| next.is_whitespace()) {
            return Some((unquote(&content[..index]), unquote(&content[index + 1..])));
        }
    }
    None
}

/// Texte sans espaces autour ni guillemets simples ou doubles qui l'entourent.
fn unquote(text: &str) -> String {
    let text = text.trim();
    for quote in ['"', '\''] {
        if let Some(inner) = text
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner.to_owned();
        }
    }
    text.to_owned()
}

/// Ligne sans son commentaire : `#` hors guillemets, en début de ligne ou après une espace.
fn strip_comment(line: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut previous: Option<char> = None;
    for (index, c) in line.char_indices() {
        match quote {
            Some(open) if c == open => quote = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == '#' && previous.is_none_or(char::is_whitespace) => {
                return &line[..index];
            }
            None => {}
        }
        previous = Some(c);
    }
    line
}

/// Appareil sur lequel Flutter sait lancer une app (glossaire : `FlutterDevice`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlutterDevice {
    /// Identifiant, passé à `flutter run -d`.
    pub id: String,
    pub name: String,
    pub platform: FlutterPlatform,
    /// Simulateur ou émulateur (par opposition à un appareil physique ou au poste).
    pub emulator: bool,
    /// Champ `sdk` de Flutter (« Android 16 (API 36) »), vide s'il manque.
    pub os: String,
}

/// Plateforme Flutter d'un `targetPlatform`, `None` si inconnue.
fn platform_of(target: &str) -> Option<FlutterPlatform> {
    match target {
        "ios" => Some(FlutterPlatform::Ios),
        "android" | "android-arm" | "android-arm64" | "android-x64" | "android-x86" => {
            Some(FlutterPlatform::Android)
        }
        "darwin" => Some(FlutterPlatform::Macos),
        "web-javascript" => Some(FlutterPlatform::Web),
        "linux-x64" | "linux-arm64" => Some(FlutterPlatform::Linux),
        "windows-x64" | "windows-arm64" => Some(FlutterPlatform::Windows),
        _ => None,
    }
}

/// Appareils de la sortie de `flutter devices --machine`, dans l'ordre de Flutter. Les lignes
/// avant la première qui commence par `[` sont ignorées. Sont écartés : `isSupported: false`,
/// plateforme inconnue, `id` ou `name` absent. Pas de JSON : erreur.
pub fn parse_flutter_devices(json: &str) -> Result<Vec<FlutterDevice>, AppError> {
    let mut offset = 0;
    let start = json
        .split_inclusive('\n')
        .find_map(|line| {
            let here = offset;
            offset += line.len();
            line.starts_with('[').then_some(here)
        })
        .ok_or_else(|| unreadable_devices(String::new()))?;

    // Lecture d'une seule valeur : un texte après le tableau est toléré.
    let value = serde_json::Deserializer::from_str(&json[start..])
        .into_iter::<Value>()
        .next()
        .ok_or_else(|| unreadable_devices(String::new()))?
        .map_err(|err| unreadable_devices(err.to_string()))?;
    let items = value
        .as_array()
        .ok_or_else(|| unreadable_devices(String::new()))?;

    Ok(items.iter().filter_map(device_of).collect())
}

/// Liste d'appareils de `flutter devices` illisible ; `error` vide si la liste manque.
fn unreadable_devices(error: String) -> AppError {
    Failure::UnreadableOutput {
        tool: "flutter devices".to_owned(),
        error,
    }
    .into()
}

/// Appareil d'un élément de la liste, `None` s'il est à ignorer.
fn device_of(item: &Value) -> Option<FlutterDevice> {
    let text = |key: &str| item.get(key).and_then(Value::as_str);
    if item.get("isSupported").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let id = text("id").filter(|id| !id.is_empty())?;
    let name = text("name").filter(|name| !name.is_empty())?;
    Some(FlutterDevice {
        id: id.to_owned(),
        name: name.to_owned(),
        platform: platform_of(text("targetPlatform")?)?,
        emulator: item.get("emulator").and_then(Value::as_bool) == Some(true),
        os: text("sdk").unwrap_or_default().to_owned(),
    })
}

/// Appareils proposés pour `app` : ceux dont la plateforme est l'une des siennes, dans l'ordre
/// de Flutter.
pub fn compatible_devices(app: &FlutterApp, devices: &[FlutterDevice]) -> Vec<FlutterDevice> {
    devices
        .iter()
        .filter(|device| app.platforms.contains(&device.platform))
        .cloned()
        .collect()
}

/// Intervalle entre deux `try_wait` pendant la lecture des appareils.
const POLL: Duration = Duration::from_millis(20);
/// Attente des fils de lecture une fois Flutter terminé : un processus petit-fils qui garde
/// le tube ouvert ne doit pas bloquer l'app.
const DRAIN: Duration = Duration::from_secs(2);

/// Lance `<flutter> devices --machine` (sans shell) et lit les appareils. Au-delà de `timeout`
/// le processus est tué : erreur « Flutter ne répond pas ». Code de sortie non nul : erreur
/// avec la sortie d'erreur.
pub fn list_flutter_devices(
    flutter: &Path,
    timeout: Duration,
) -> Result<Vec<FlutterDevice>, AppError> {
    let mut child = Command::new(flutter)
        .args(["devices", "--machine"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Io(format!("Flutter ({}): {e}", flutter.display())))?;

    // Un fil par tube : lire l'un après l'autre pourrait bloquer Flutter sur l'autre.
    let stdout = child.stdout.take().map(drain);
    let stderr = child.stderr.take().map(drain);

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL),
            Ok(None) => {
                // Le fils tué laisse ses tubes se fermer ; les fils de lecture s'arrêtent seuls.
                let _ = child.kill();
                let _ = child.wait();
                return Err(Failure::FlutterTimeout.into());
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Io(format!("Flutter: {e}")));
            }
        }
    };

    let collect = |receiver: Option<mpsc::Receiver<Vec<u8>>>| {
        receiver
            .and_then(|r| r.recv_timeout(DRAIN).ok())
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    };
    let (stdout, stderr) = (collect(stdout), collect(stderr));
    if !status.success() {
        let detail = stderr.trim();
        return Err(AppError::Io(if detail.is_empty() {
            format!("flutter devices: {status}")
        } else {
            format!("flutter devices: {detail}")
        }));
    }
    parse_flutter_devices(&stdout)
}

/// Lit `pipe` jusqu'à sa fin dans un fil et envoie les octets lus.
fn drain<R: Read + Send + 'static>(mut pipe: R) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });
    receiver
}

/// Emplacements usuels de Flutter sous le dossier personnel.
const HOME_DIRS: [&str; 3] = ["flutter/bin", "development/flutter/bin", "fvm/default/bin"];
/// Emplacements usuels de Flutter hors du dossier personnel.
const FIXED_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// Premier exécutable `flutter` : SDK de FVM du projet, dossiers de `path`, dossiers usuels
/// de `home`, puis `/opt/homebrew/bin` et `/usr/local/bin`. Le Finder donne à l'app un `PATH`
/// réduit, d'où ces emplacements.
pub fn find_flutter_in(
    project_dir: &Path,
    home: Option<&Path>,
    path: Option<&OsStr>,
) -> Option<PathBuf> {
    let fvm = project_dir.join(".fvm/flutter_sdk/bin");
    let from_path = path.into_iter().flat_map(std::env::split_paths);
    let from_home = home
        .into_iter()
        .flat_map(|home| HOME_DIRS.iter().map(move |dir| home.join(dir)));
    let fixed = FIXED_DIRS.iter().map(PathBuf::from);

    std::iter::once(fvm)
        .chain(from_path.filter(|dir| !dir.as_os_str().is_empty()))
        .chain(from_home)
        .chain(fixed)
        .map(|dir| dir.join("flutter"))
        .find(|candidate| is_executable_file(candidate))
}

/// `find_flutter_in` avec `HOME` et `PATH` du processus.
pub fn find_flutter(project_dir: &Path) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let path = std::env::var_os("PATH");
    find_flutter_in(project_dir, home.as_deref(), path.as_deref())
}

/// Fichier (liens suivis) avec un droit d'exécution : un dossier `flutter` n'en est pas un.
fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Délai maximal d'une lecture des appareils depuis l'app (décision 0022).
const DEVICES_TIMEOUT: Duration = Duration::from_secs(30);
/// Âge au-delà duquel la liste gardée est relue à l'ouverture du menu.
const DEVICES_TTL: Duration = Duration::from_secs(15);

/// Appareils Flutter proposés à une app, ou Flutter introuvable (l'app reste listée, Lancer
/// est désactivé).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FlutterDevices {
    pub flutter_found: bool,
    /// Appareils dont la plateforme est l'une de celles de l'app, dans l'ordre de Flutter.
    pub devices: Vec<FlutterDevice>,
}

/// Lecture gardée de `flutter devices`, par exécutable Flutter (décision 0022) : en mémoire,
/// pour la session. Le verrou reste pris pendant la lecture : une seule à la fois, les autres
/// apps Flutter attendent son résultat.
pub struct FlutterDeviceCache {
    ttl: Duration,
    read: Mutex<HashMap<PathBuf, (Instant, Vec<FlutterDevice>)>>,
}

impl Default for FlutterDeviceCache {
    fn default() -> Self {
        Self::new(DEVICES_TTL)
    }
}

impl FlutterDeviceCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            read: Mutex::new(HashMap::new()),
        }
    }

    /// Appareils compatibles avec l'app de `dir`. Relit `flutter devices` si la liste gardée
    /// date de plus de `ttl` ou si `refresh` ; une lecture en erreur ne remplace pas la liste
    /// gardée. Flutter introuvable : `flutter_found` faux, sans erreur.
    pub fn devices_for(&self, dir: &Path, refresh: bool) -> Result<FlutterDevices, AppError> {
        let Some(flutter) = find_flutter(dir) else {
            return Ok(FlutterDevices {
                flutter_found: false,
                devices: Vec::new(),
            });
        };
        let mut read = self
            .read
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Une liste vide n'est jamais gardée : l'utilisateur démarre un simulateur puis rouvre
        // le menu, il doit le voir tout de suite.
        let fresh = read
            .get(&flutter)
            .filter(|(at, devices)| !refresh && !devices.is_empty() && at.elapsed() < self.ttl);
        let all = match fresh {
            Some((_, devices)) => devices.clone(),
            None => {
                let devices = list_flutter_devices(&flutter, DEVICES_TIMEOUT)?;
                read.insert(flutter, (Instant::now(), devices.clone()));
                devices
            }
        };
        let platforms = platforms_in(dir);
        Ok(FlutterDevices {
            flutter_found: true,
            devices: all
                .into_iter()
                .filter(|device| platforms.contains(&device.platform))
                .collect(),
        })
    }
}

/// Commande tapée dans le terminal : `<flutter> run -d <id>`, chemin absolu de Flutter (le
/// shell du terminal ne l'a pas forcément dans son `PATH`), les deux cités pour le shell.
pub fn flutter_command(flutter: &Path, device_id: &str) -> String {
    format!(
        "{} run -d {}",
        shell_quote(&flutter.to_string_lossy()),
        shell_quote(device_id)
    )
}
