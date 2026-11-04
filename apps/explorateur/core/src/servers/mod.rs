//! Serveurs de développement du dossier racine (spec `serveurs-locaux.md`, décision 0008) :
//! scripts des `package.json` et configurations de `.claude/launch.json`, détectés à la demande.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::apps;
use crate::git::Git;
use crate::tree::is_hidden;

/// Dossiers de dépendances et de build, sautés par leur nom exact (spec `menu-apps-allege.md`) :
/// ils contiennent des projets et des `package.json` qui ne sont pas ceux du dépôt. `dist` et
/// `out` n'y sont pas : ils peuvent porter une vraie app. L'arborescence, ⌘P et ⌘⇧F gardent
/// leur propre liste (`NOISY_DIRS`). Le navigateur simulé a la même (`mock-servers.ts`).
const DEPENDENCY_DIRS: [&str; 8] = [
    "SourcePackages",
    "DerivedData",
    "Pods",
    "Carthage",
    "build",
    "vendor",
    "bower_components",
    "jspm_packages",
];

/// Scripts reconnus, dans l'ordre d'affichage.
const SCRIPTS: [&str; 5] = ["dev", "start", "preview", "serve", "storybook"];
/// Niveaux de sous-dossiers parcourus sous le dossier racine.
const MAX_DEPTH: usize = 6;
/// Fichiers de verrouillage et leur gestionnaire, cherchés dans cet ordre dans chaque dossier.
const LOCK_FILES: [(&str, &str); 4] = [
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
];
/// Délai du test de connexion : un serveur local répond en quelques millisecondes.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(200);

/// Origine d'un serveur détecté.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ServerSource {
    PackageJson,
    LaunchJson,
}

/// Serveur de développement détecté (glossaire : `Server`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    /// « <nom> · <script> » (`package.json`) ou nom de la configuration (`launch.json`).
    pub name: String,
    pub source: ServerSource,
    /// Texte du script `package.json` (sous-titre). `None` pour `launch.json`.
    pub script: Option<String>,
    /// Dossier de lancement, absolu.
    pub dir: String,
    /// `dir` relatif au dossier racine, `/` comme séparateur, `"."` pour la racine.
    pub relative_dir: String,
    /// Commande tapée dans le terminal. `None` : serveur lancé ailleurs (Aperçu seul).
    pub command: Option<String>,
    /// Port attendu, s'il est connu avant le lancement.
    pub port: Option<u16>,
    /// URL connue avant le lancement (`launch.json` seulement).
    pub url: Option<String>,
}

/// Résultat de la détection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerList {
    /// Configurations de `launch.json` d'abord, puis les scripts des `package.json`.
    pub servers: Vec<Server>,
    /// `.claude/launch.json` illisible ou mal formé : texte brut de l'erreur (système ou serde),
    /// placé par le front dans une phrase traduite.
    pub launch_error: Option<String>,
}

/// Serveurs de `root`. Infaillible : une erreur de `launch.json` va dans `launch_error`,
/// un `package.json` illisible est ignoré.
pub fn detect_servers(root: &str) -> ServerList {
    detect_with(root, &HashSet::new())
}

/// Comme `detect_servers`, mais dans un dépôt git les dossiers ignorés par git ne sont pas
/// parcourus. Hors dépôt ou git absent : `detect_servers`.
pub fn detect_servers_git(git: &Git, root: &str) -> ServerList {
    detect_with(root, &ignored_paths(git, root))
}

fn detect_with(root: &str, ignored: &HashSet<String>) -> ServerList {
    let root_path = Path::new(root);
    let (mut servers, launch_error) = match read_launch_json(root_path) {
        Ok(list) => (list, None),
        Err(message) => (Vec::new(), Some(message)),
    };

    for (rel, dir) in sorted_package_dirs(root_path, scan(root_path, ignored).package_dirs) {
        servers.extend(package_servers(root_path, &dir, rel));
    }
    ServerList {
        servers,
        launch_error,
    }
}

/// Dossiers de `package.json` avec leur chemin relatif : le dossier racine d'abord, puis
/// l'ordre alphabétique des chemins.
pub(crate) fn sorted_package_dirs(root: &Path, dirs: Vec<PathBuf>) -> Vec<(String, PathBuf)> {
    let mut packages: Vec<(String, PathBuf)> = dirs
        .into_iter()
        .map(|dir| (relative_dir(root, &dir), dir))
        .collect();
    packages.sort_by(|(a, _), (b, _)| (a != ".", a).cmp(&(b != ".", b)));
    packages
}

/// Vrai si un serveur accepte une connexion TCP sur `port` en local. Essaie IPv4 puis IPv6 :
/// Node résout `localhost` en `::1` sur macOS, et Vite n'écoute alors que là.
pub fn is_port_open(port: u16) -> bool {
    [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ]
    .iter()
    .any(|addr| TcpStream::connect_timeout(addr, CONNECT_TIMEOUT).is_ok())
}

/// Ce que trouve le parcours du dossier racine, partagé par les serveurs et les apps natives.
pub(crate) struct Scan {
    /// Dossiers contenant un `package.json`.
    pub package_dirs: Vec<PathBuf>,
    /// Dossiers contenant un `pubspec.yaml` (apps Flutter).
    pub pubspec_dirs: Vec<PathBuf>,
    /// Paquets `*.xcodeproj` et `*.xcworkspace` (non parcourus).
    pub xcode_bundles: Vec<PathBuf>,
    /// Dossiers contenant un `Cargo.toml`.
    pub cargo_dirs: Vec<PathBuf>,
    /// Dossiers contenant un `Package.swift`.
    pub swift_dirs: Vec<PathBuf>,
    /// Dossiers contenant un `settings.gradle.kts` ou un `settings.gradle` (projets Gradle).
    pub gradle_dirs: Vec<PathBuf>,
}

/// Parcourt `root` jusqu'à `MAX_DEPTH` niveaux, sans les éléments masqués, les dossiers de
/// dépendances (`DEPENDENCY_DIRS`) ni les liens vers des dossiers. Un dossier dont le chemin
/// relatif à `root` est dans `ignored` (ignoré par git) n'est pas parcouru non plus. Les
/// paquets Xcode sont relevés sans y entrer, ignorés ou non : un projet généré (XcodeGen) est
/// souvent ignoré par `*.xcodeproj` et reste l'app. Les fichiers ne sont jamais écartés par
/// `ignored`.
pub(crate) fn scan(root: &Path, ignored: &HashSet<String>) -> Scan {
    let mut found = Scan {
        package_dirs: Vec::new(),
        pubspec_dirs: Vec::new(),
        xcode_bundles: Vec::new(),
        cargo_dirs: Vec::new(),
        swift_dirs: Vec::new(),
        gradle_dirs: Vec::new(),
    };
    // Chaque dossier à parcourir porte son chemin relatif à `root` (vide pour `root`).
    let mut pending = vec![(root.to_path_buf(), String::new(), 0)];
    while let Some((dir, relative, depth)) = pending.pop() {
        let Ok(reader) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in reader.filter_map(std::result::Result::ok) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() {
                if is_hidden(&name, true) || DEPENDENCY_DIRS.contains(&name.as_str()) {
                    continue;
                }
                if name.ends_with(".xcodeproj") || name.ends_with(".xcworkspace") {
                    found.xcode_bundles.push(entry.path());
                } else if depth < MAX_DEPTH {
                    let child = if relative.is_empty() {
                        name
                    } else {
                        format!("{relative}/{name}")
                    };
                    if !ignored.contains(&child) {
                        pending.push((entry.path(), child, depth + 1));
                    }
                }
            } else if name == "package.json" {
                found.package_dirs.push(dir.clone());
            } else if name == "pubspec.yaml" {
                found.pubspec_dirs.push(dir.clone());
            } else if name == "Cargo.toml" {
                found.cargo_dirs.push(dir.clone());
            } else if name == "Package.swift" {
                found.swift_dirs.push(dir.clone());
            } else if (name == "settings.gradle.kts" || name == "settings.gradle")
                && found.gradle_dirs.last() != Some(&dir)
            {
                // Les deux fichiers d'un même dossier arrivent dans la même boucle : un seul ajout.
                found.gradle_dirs.push(dir.clone());
            }
        }
    }
    found
}

/// Ensemble des chemins ignorés par git sous `root` (relatifs, sans `/` final). Vide hors d'un
/// dépôt, si git est introuvable ou en cas d'erreur : le parcours se fait alors sans la règle git.
pub(crate) fn ignored_paths(git: &Git, root: &str) -> HashSet<String> {
    crate::git::get_path_statuses(git, root)
        .map(|statuses| statuses.ignored.into_iter().collect())
        .unwrap_or_default()
}

/// `package.json` de `dir` : nom du paquet (sinon nom du dossier) et scripts. `None` s'il est
/// illisible, mal formé ou sans scripts.
pub(crate) fn read_package(dir: &Path) -> Option<(String, serde_json::Map<String, Value>)> {
    let text = fs::read_to_string(dir.join("package.json")).ok()?;
    let mut json = serde_json::from_str::<Value>(&text).ok()?;
    let name = json
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .map_or_else(|| folder_name(dir), str::to_owned);
    match json.get_mut("scripts")?.take() {
        Value::Object(scripts) => Some((name, scripts)),
        _ => None,
    }
}

/// Serveurs d'un `package.json` ; rien s'il est illisible ou mal formé.
fn package_servers(root: &Path, dir: &Path, relative_dir: String) -> Vec<Server> {
    let Some((name, scripts)) = read_package(dir) else {
        return Vec::new();
    };
    let manager = package_manager(root, dir);
    let dir_text = dir.to_string_lossy().into_owned();
    // Le script qui lance Electron devient une app (spec apps-commandes.md), pas un serveur.
    let electron = apps::electron_script(dir, &scripts);

    SCRIPTS
        .iter()
        .filter_map(|script| {
            let text = scripts.get(*script)?.as_str()?;
            if text == "tauri" || text.starts_with("tauri ") || electron.as_deref() == Some(*script)
            {
                return None;
            }
            Some(Server {
                name: format!("{name} · {script}"),
                source: ServerSource::PackageJson,
                script: Some(text.to_owned()),
                dir: dir_text.clone(),
                relative_dir: relative_dir.clone(),
                command: Some(format!("{manager} run {script}")),
                port: port_in(text),
                url: None,
            })
        })
        .collect()
}

/// Gestionnaire du premier fichier de verrouillage trouvé en remontant de `dir` à `root`.
pub(crate) fn package_manager(root: &Path, dir: &Path) -> &'static str {
    for ancestor in dir.ancestors() {
        if let Some((_, manager)) = LOCK_FILES
            .iter()
            .find(|(file, _)| ancestor.join(file).is_file())
        {
            return manager;
        }
        if ancestor == root {
            break;
        }
    }
    "npm"
}

/// Port d'une commande : `--port N`, `--port=N` ou `-p N`.
fn port_in(command: &str) -> Option<u16> {
    let words: Vec<&str> = command.split_whitespace().collect();
    words.iter().enumerate().find_map(|(i, word)| {
        if let Some(value) = word.strip_prefix("--port=") {
            return value.parse().ok();
        }
        if *word == "--port" || *word == "-p" {
            return words.get(i + 1)?.parse().ok();
        }
        None
    })
}

/// Forme attendue de `launch.json` : serde décrit lui-même l'écart (champ absent, pas une liste).
#[derive(serde::Deserialize)]
struct LaunchFile {
    configurations: Vec<Value>,
}

/// Configurations de `root/.claude/launch.json`. Fichier absent : aucune, sans erreur. L'erreur
/// est le texte brut du système ou de serde, que le front place dans sa phrase.
fn read_launch_json(root: &Path) -> Result<Vec<Server>, String> {
    let path = root.join(".claude").join("launch.json");
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.to_string()),
    };
    let LaunchFile { configurations } =
        serde_json::from_str(&text).map_err(|err| err.to_string())?;
    let dir = root.to_string_lossy().into_owned();
    Ok(configurations
        .iter()
        .enumerate()
        .map(|(i, config)| launch_server(config, i, &dir))
        .collect())
}

/// Serveur d'une configuration de `launch.json` (champs inattendus ignorés).
fn launch_server(config: &Value, index: usize, dir: &str) -> Server {
    let text = |key: &str| config.get(key).and_then(Value::as_str).map(str::to_owned);
    let name = text("name").unwrap_or_else(|| format!("launch.json #{}", index + 1));
    let args: Vec<&str> = config
        .get("runtimeArgs")
        .and_then(Value::as_array)
        .map(|args| args.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let command = text("runtimeExecutable").map(|exe| {
        std::iter::once(exe.as_str())
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" ")
    });
    let port = config
        .get("port")
        .and_then(Value::as_u64)
        .and_then(|p| u16::try_from(p).ok());
    let url = text("url").or_else(|| port.map(|p| format!("http://localhost:{p}")));
    Server {
        name,
        source: ServerSource::LaunchJson,
        script: None,
        dir: dir.to_owned(),
        relative_dir: ".".to_owned(),
        command,
        port,
        url,
    }
}

/// Chemin de `dir` relatif à `root`, `/` comme séparateur, `"."` pour la racine.
pub(crate) fn relative_dir(root: &Path, dir: &Path) -> String {
    let rel = dir.strip_prefix(root).unwrap_or(dir);
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.is_empty() {
        ".".to_owned()
    } else {
        parts.join("/")
    }
}

pub(crate) fn folder_name(dir: &Path) -> String {
    dir.file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}
