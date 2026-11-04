//! Projets Xcode : schémas et plateformes lus dans le texte de `project.pbxproj`, des
//! `.xcscheme` partagés et de `contents.xcworkspacedata` (décision 0009, sans parser de plist).

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{AppKind, AppTarget, DeviceSource, NativeApp};
use crate::servers::relative_dir;

const APPLICATION: &str = "\"com.apple.product-type.application\"";

/// Plateformes d'un projet ou d'un workspace.
#[derive(Default, Clone, Copy)]
struct Platforms {
    ios: bool,
    watchos: bool,
    tvos: bool,
    visionos: bool,
    macos: bool,
    /// Une ligne `SUPPORTS_MACCATALYST = YES` a été lue. Mac Catalyst n'existe que si iOS aussi
    /// est reconnu : voir `targets`.
    catalyst_flag: bool,
}

impl Platforms {
    /// Au moins une plateforme lue (le réglage Catalyst seul n'en est pas une).
    fn any(self) -> bool {
        self.ios || self.watchos || self.tvos || self.visionos || self.macos
    }

    fn union(self, other: Self) -> Self {
        Self {
            ios: self.ios || other.ios,
            watchos: self.watchos || other.watchos,
            tvos: self.tvos || other.tvos,
            visionos: self.visionos || other.visionos,
            macos: self.macos || other.macos,
            catalyst_flag: self.catalyst_flag || other.catalyst_flag,
        }
    }

    /// Cibles reconnues, dans l'ordre du menu : id, libellé, genre, source d'appareils. Mac
    /// Catalyst : iOS et le réglage, évalués après l'union des projets d'un workspace.
    fn targets(self) -> Vec<Target> {
        use DeviceSource::{IosSimulators, TvosSimulators, VisionosSimulators, WatchosSimulators};
        [
            (self.ios, "ios", "iOS", AppKind::Ios, Some(IosSimulators)),
            (
                self.watchos,
                "watchos",
                "watchOS",
                AppKind::Watchos,
                Some(WatchosSimulators),
            ),
            (
                self.tvos,
                "tvos",
                "tvOS",
                AppKind::Tvos,
                Some(TvosSimulators),
            ),
            (
                self.visionos,
                "visionos",
                "visionOS",
                AppKind::Visionos,
                Some(VisionosSimulators),
            ),
            (self.macos, "macos", "macOS", AppKind::Macos, None),
            (
                self.ios && self.catalyst_flag,
                "catalyst",
                "Mac (Catalyst)",
                AppKind::Catalyst,
                None,
            ),
        ]
        .into_iter()
        .filter(|(on, ..)| *on)
        .map(|(_, id, label, kind, device_source)| (id, label, kind, device_source))
        .collect()
    }
}

/// Cible d'une plateforme : id, libellé, genre, source d'appareils.
type Target = (&'static str, &'static str, AppKind, Option<DeviceSource>);

/// Apps des paquets Xcode trouvés : les workspaces, puis les projets qu'aucun d'eux ne liste.
pub(super) fn xcode_apps(root: &Path, bundles: &[PathBuf]) -> Vec<NativeApp> {
    let mut apps = Vec::new();
    let mut claimed: BTreeSet<PathBuf> = BTreeSet::new();

    for workspace in bundles.iter().filter(|b| has_extension(b, "xcworkspace")) {
        let Ok(data) = fs::read_to_string(workspace.join("contents.xcworkspacedata")) else {
            continue;
        };
        let base = workspace.parent().unwrap_or(workspace);
        let projects: Vec<PathBuf> = workspace_locations(&data)
            .into_iter()
            .filter_map(|location| resolve_location(base, &location))
            .filter(|p| has_extension(p, "xcodeproj"))
            .collect();
        let mut schemes = shared_schemes(workspace);
        let mut pbxs = Vec::new();
        for project in &projects {
            claimed.insert(normalize(project));
            let Ok(pbx) = fs::read_to_string(project.join("project.pbxproj")) else {
                continue;
            };
            for (name, blueprint) in project_schemes(project, &pbx) {
                schemes.entry(name).or_insert(blueprint);
            }
            pbxs.push(pbx);
        }
        let parsed: Vec<Project> = pbxs.iter().map(|pbx| Project::new(pbx)).collect();
        apps.extend(entries(root, workspace, &schemes, &parsed));
    }

    for project in bundles.iter().filter(|b| has_extension(b, "xcodeproj")) {
        if claimed.contains(&normalize(project)) {
            continue;
        }
        let Ok(pbx) = fs::read_to_string(project.join("project.pbxproj")) else {
            continue;
        };
        let schemes = project_schemes(project, &pbx);
        apps.extend(entries(root, project, &schemes, &[Project::new(&pbx)]));
    }
    apps
}

/// Schémas d'un paquet : nom, et identifiant de la cible que le schéma lance si son fichier
/// le dit (sinon la cible de même nom).
type Schemes = BTreeMap<String, Option<String>>;

/// Une app par schéma, avec une cible par plateforme reconnue de la cible du schéma (iOS puis
/// macOS). Aucune plateforme : pas d'app pour ce schéma.
fn entries(root: &Path, bundle: &Path, schemes: &Schemes, projects: &[Project]) -> Vec<NativeApp> {
    let dir = bundle
        .parent()
        .unwrap_or(bundle)
        .to_string_lossy()
        .into_owned();
    let relative = relative_dir(root, bundle);
    let project = bundle.to_string_lossy().into_owned();
    schemes
        .iter()
        .filter_map(|(scheme, blueprint)| {
            let kinds = scheme_platforms(projects, scheme, blueprint.as_deref()).targets();
            if kinds.is_empty() {
                return None;
            }
            Some(NativeApp {
                name: scheme.clone(),
                dir: dir.clone(),
                relative_dir: relative.clone(),
                targets: kinds
                    .iter()
                    .map(|&(id, label, kind, device_source)| AppTarget {
                        id: id.to_owned(),
                        label: label.to_owned(),
                        kind,
                        device_source,
                        project: Some(project.clone()),
                        scheme: Some(scheme.clone()),
                        command: None,
                    })
                    .collect(),
            })
        })
        .collect()
}

/// Plateformes d'un schéma : celles de sa cible, cherchée dans chaque projet (par identifiant,
/// sinon par nom de schéma). Cible introuvable ou sans plateforme lue : union des plateformes
/// de tout le texte de tous les projets (repli).
fn scheme_platforms(projects: &[Project], scheme: &str, blueprint: Option<&str>) -> Platforms {
    let found = projects.iter().find_map(|project| {
        let target = match blueprint {
            Some(id) => project.target_by_id(id),
            None => project.target_by_name(scheme),
        }?;
        Some(project.target_platforms(target))
    });
    found.filter(|p| p.any()).unwrap_or_else(|| {
        projects.iter().fold(Platforms::default(), |all, p| {
            all.union(read_platforms(p.pbx))
        })
    })
}

/// Schémas d'un `.xcodeproj` : ses schémas partagés, sinon ses cibles d'application.
fn project_schemes(project: &Path, pbx: &str) -> Schemes {
    let shared = shared_schemes(project);
    if shared.is_empty() {
        application_targets(pbx)
            .into_iter()
            .map(|name| (name, None))
            .collect()
    } else {
        shared
    }
}

/// `xcshareddata/xcschemes/*.xcscheme` lisibles d'un paquet : nom et cible lancée.
fn shared_schemes(bundle: &Path) -> Schemes {
    let Ok(reader) = fs::read_dir(bundle.join("xcshareddata").join("xcschemes")) else {
        return Schemes::new();
    };
    reader
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| has_extension(path, "xcscheme"))
        .filter_map(|path| {
            let xml = fs::read(&path).ok()?;
            let name = path.file_stem()?.to_string_lossy().into_owned();
            Some((name, launched_blueprint(&String::from_utf8_lossy(&xml))))
        })
        .collect()
}

/// Identifiant de la cible d'un schéma : la référence du `BuildableProductRunnable` de son
/// `LaunchAction` (un `ProfileAction` en a une aussi, d'où le découpage), sinon la première
/// `BuildableReference` du fichier.
fn launched_blueprint(xml: &str) -> Option<String> {
    let launch = xml
        .split("<LaunchAction")
        .nth(1)
        .and_then(|rest| rest.split("</LaunchAction>").next())
        .and_then(|action| action.split("<BuildableProductRunnable").nth(1))
        .and_then(first_blueprint);
    launch.or_else(|| first_blueprint(xml))
}

/// Valeur de `BlueprintIdentifier` de la première `<BuildableReference` du texte.
fn first_blueprint(text: &str) -> Option<String> {
    let tag = text
        .split("<BuildableReference")
        .nth(1)?
        .split('>')
        .next()?;
    let id = tag
        .split("BlueprintIdentifier = \"")
        .nth(1)?
        .split('"')
        .next()?;
    Some(id.to_owned())
}

/// Projet lu : texte du `project.pbxproj` et objets de `objects`, indexés par identifiant.
struct Project<'a> {
    pbx: &'a str,
    objects: BTreeMap<&'a str, &'a str>,
}

impl<'a> Project<'a> {
    fn new(pbx: &'a str) -> Self {
        Self {
            pbx,
            objects: index_objects(pbx),
        }
    }

    /// Objet `PBXNativeTarget` d'identifiant `id`.
    fn target_by_id(&self, id: &str) -> Option<&'a str> {
        self.objects
            .get(id)
            .copied()
            .filter(|o| is_isa(o, "PBXNativeTarget"))
    }

    /// Objet `PBXNativeTarget` de nom `name`.
    fn target_by_name(&self, name: &str) -> Option<&'a str> {
        self.objects.values().copied().find(|o| {
            is_isa(o, "PBXNativeTarget") && object_field(o, "name").map(setting_value) == Some(name)
        })
    }

    /// Plateformes lues dans les configurations de la liste de l'objet (cible ou projet).
    fn config_platforms(&self, owner: &str) -> Platforms {
        let list = object_field(owner, "buildConfigurationList")
            .and_then(|value| setting_value(value).split_whitespace().next())
            .and_then(|id| self.objects.get(id));
        let ids = list.map_or_else(Vec::new, |list| array_ids(list, "buildConfigurations"));
        ids.iter()
            .filter_map(|id| self.objects.get(id.as_str()))
            .fold(Platforms::default(), |all, config| {
                all.union(read_platforms(config))
            })
    }

    /// Plateformes d'une cible : ses configurations, sinon celles du projet (vide si aucune
    /// n'est lue : `scheme_platforms` se replie alors). `SUPPORTS_MACCATALYST` du projet vaut
    /// pour la cible (hérité).
    fn target_platforms(&self, target: &str) -> Platforms {
        let own = self.config_platforms(target);
        let project = self
            .objects
            .values()
            .find(|o| is_isa(o, "PBXProject"))
            .map_or_else(Platforms::default, |o| self.config_platforms(o));
        let mut platforms = if own.any() { own } else { project };
        platforms.catalyst_flag = own.catalyst_flag || project.catalyst_flag;
        platforms
    }
}

/// Objets de `objects` (profondeur 2) par identifiant : texte de `{` à l'accolade fermante
/// qui l'équilibre. Les chaînes entre guillemets et les commentaires `/* */` sont sautés, car
/// ils peuvent contenir des accolades.
fn index_objects(pbx: &str) -> BTreeMap<&str, &str> {
    let bytes = pbx.as_bytes();
    let mut objects = BTreeMap::new();
    let (mut depth, mut i) = (0usize, 0usize);
    // Début de l'instruction en cours à la profondeur 2 : l'identifiant de l'objet est avant `{`.
    let (mut statement, mut object_start, mut id) = (0usize, 0usize, "");
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                i = after_string(bytes, i);
                continue;
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = pbx[i..].find("*/").map_or(bytes.len(), |end| i + end + 2);
                continue;
            }
            b'{' => {
                depth += 1;
                if depth == 2 {
                    statement = i + 1;
                } else if depth == 3 {
                    id = object_id(&pbx[statement..i]);
                    object_start = i;
                }
            }
            b'}' => {
                if depth == 3 {
                    objects.insert(id, &pbx[object_start..=i]);
                }
                depth = depth.saturating_sub(1);
            }
            b';' if depth == 2 => statement = i + 1,
            _ => {}
        }
        i += 1;
    }
    objects
}

/// Indice qui suit la chaîne entre guillemets commençant à `start` (`\"` échappé géré).
fn after_string(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// Identifiant en tête d'une instruction `ID /* commentaire */ = {` (commentaires de section
/// avant lui ignorés).
fn object_id(header: &str) -> &str {
    let mut rest = header.trim_start();
    while rest.starts_with("/*") {
        rest = rest
            .split_once("*/")
            .map_or("", |(_, after)| after)
            .trim_start();
    }
    rest.split(|c: char| c.is_whitespace() || c == '=')
        .next()
        .unwrap_or("")
}

fn is_isa(object: &str, isa: &str) -> bool {
    object_field(object, "isa").map(setting_value) == Some(isa)
}

/// Valeur brute de la première ligne `clé = valeur;` de l'objet.
fn object_field<'a>(object: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key} = ");
    object
        .lines()
        .find_map(|line| line.trim().strip_prefix(prefix.as_str()))
}

/// Identifiants d'un tableau `clé = ( ID /* commentaire */, ... );` de l'objet.
fn array_ids(object: &str, key: &str) -> Vec<String> {
    let start = format!("{key} = (");
    let Some(position) = object.find(&start) else {
        return Vec::new();
    };
    let mut rest = &object[position + start.len()..];
    let mut body = String::new();
    // Commentaires retirés : ils peuvent contenir une virgule ou une parenthèse.
    while let Some(open) = rest.find("/*") {
        body.push_str(&rest[..open]);
        rest = rest[open..].split_once("*/").map_or("", |(_, after)| after);
    }
    body.push_str(rest);
    body.split(')')
        .next()
        .unwrap_or("")
        .split(',')
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect()
}

/// Noms des cibles `PBXNativeTarget` de type application.
fn application_targets(pbx: &str) -> BTreeSet<String> {
    pbx.split("isa = PBXNativeTarget;")
        .skip(1)
        .filter_map(|rest| {
            // Une cible n'a pas d'accolade interne : son texte s'arrête à la première fermante.
            let body = rest.split("};").next()?;
            let mut name = None;
            let mut application = false;
            for line in body.lines().map(str::trim) {
                if let Some(value) = line.strip_prefix("name = ") {
                    name = Some(setting_value(value).to_owned());
                } else if let Some(value) = line.strip_prefix("productType = ") {
                    application = value.trim_end_matches(';') == APPLICATION;
                }
            }
            name.filter(|_| application)
        })
        .collect()
}

/// Plateformes lues dans les réglages `SDKROOT`, `SUPPORTED_PLATFORMS` et
/// `SUPPORTS_MACCATALYST`.
fn read_platforms(pbx: &str) -> Platforms {
    let mut platforms = Platforms::default();
    for line in pbx.lines().map(str::trim) {
        let values: Vec<&str> = if let Some(value) = line.strip_prefix("SDKROOT = ") {
            vec![setting_value(value)]
        } else if let Some(value) = line.strip_prefix("SUPPORTED_PLATFORMS = ") {
            setting_value(value).split_whitespace().collect()
        } else {
            if let Some(value) = line.strip_prefix("SUPPORTS_MACCATALYST = ") {
                platforms.catalyst_flag |= setting_value(value) == "YES";
            }
            continue;
        };
        platforms.ios |= values.contains(&"iphoneos");
        platforms.watchos |= values.contains(&"watchos");
        platforms.tvos |= values.contains(&"appletvos");
        platforms.visionos |= values.contains(&"xros");
        platforms.macos |= values.contains(&"macosx");
    }
    platforms
}

/// Valeur d'un réglage `clé = valeur;` : point-virgule et guillemets retirés.
fn setting_value(value: &str) -> &str {
    value.trim().trim_end_matches(';').trim().trim_matches('"')
}

/// Valeurs des attributs `location` de `contents.xcworkspacedata`.
fn workspace_locations(data: &str) -> Vec<String> {
    data.split("location = \"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next().map(str::to_owned))
        .collect()
}

/// Chemin d'une référence de workspace (`group:`, `container:` relatifs au dossier du
/// workspace, `absolute:`) ; `self:` et les autres formes : aucun.
fn resolve_location(base: &Path, location: &str) -> Option<PathBuf> {
    let (kind, path) = location.split_once(':')?;
    match kind {
        "group" | "container" if !path.is_empty() => Some(base.join(path)),
        "absolute" => Some(PathBuf::from(path)),
        _ => None,
    }
}

/// Normalisation lexicale (`.` et `..` résolus) pour comparer deux chemins.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|e| e == extension)
}
