//! Aperçu d'une présentation `.pptx` : Quick Look de macOS d'abord, repli simplifié en Rust,
//! rendu mis en cache sur disque (décision 0025, spec `apercu-pptx.md`).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::preview::revision_of;
use crate::process::run_with_timeout;
use crate::{AppError, Result};

mod sheet;
mod simplified;
mod slide;

pub use simplified::render_simplified;

const QLMANAGE: &str = "/usr/bin/qlmanage";
const QUICK_LOOK_TIMEOUT: Duration = Duration::from_secs(15);
/// Nombre d'entrées gardées dans le cache (les plus anciennes sont supprimées au-delà).
const MAX_ENTRIES: usize = 30;
const HTML_NAME: &str = "Preview.html";
const META_NAME: &str = "render.json";

/// Moteur qui a produit un rendu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum RenderEngine {
    QuickLook,
    Simplified,
}

/// Rendu d'une présentation : `html` est le chemin absolu du `Preview.html` à afficher.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct PresentationRender {
    pub html: String,
    pub slides: u32,
    pub engine: RenderEngine,
}

/// Contenu de `render.json`, à côté du HTML : ce qu'on ne peut pas déduire du HTML seul.
#[derive(Serialize, Deserialize)]
struct Meta {
    slides: u32,
    engine: RenderEngine,
}

/// Rend `path` dans `cache_dir/presentations/<clé>/`, ou rend l'entrée déjà présente pour cette
/// révision du fichier (sa date est alors rafraîchie, ce qui la protège de la purge).
pub fn render_presentation(path: &Path, cache_dir: &Path) -> Result<PresentationRender> {
    let shown = path.to_string_lossy();
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, &shown))?;
    if meta.is_dir() {
        return Err(AppError::NotAFile(shown.into_owned()));
    }
    let cache_dir = std::path::absolute(cache_dir)
        .map_err(|e| AppError::from_io(&e, &cache_dir.to_string_lossy()))?;
    let root = cache_dir.join("presentations");
    let key = cache_key(&shown, &revision_of(&meta));
    let entry = root.join(&key);

    if let Some(hit) = read_entry(&entry) {
        touch(&entry);
        return Ok(hit);
    }
    // Une entrée sans `render.json` lisible est un reste : on la remplace.
    if entry.exists() {
        let _ = fs::remove_dir_all(&entry);
    }

    fs::create_dir_all(&root).map_err(|e| AppError::from_io(&e, &root.to_string_lossy()))?;
    let tmp = root.join(format!("{key}.tmp-{}", uuid::Uuid::new_v4()));
    let built = build(path, &cache_dir, &tmp);
    if let Err(e) = built {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    touch(&tmp);
    // Publication atomique : le renommage échoue si une entrée complète existe déjà (rendu
    // simultané du même fichier). On garde alors celle-là.
    let published = match fs::rename(&tmp, &entry) {
        Ok(()) => read_entry(&entry),
        Err(_) => {
            let _ = fs::remove_dir_all(&tmp);
            read_entry(&entry)
        }
    };
    let render =
        published.ok_or_else(|| AppError::Io(format!("{}: entrée de cache", entry.display())))?;
    evict(&root, &entry);
    Ok(render)
}

/// Produit le rendu complet dans `tmp` (qui n'existe pas encore) : Quick Look si possible,
/// sinon le repli. `render.json` est écrit en dernier.
fn build(path: &Path, cache_dir: &Path, tmp: &Path) -> Result<()> {
    let tmp_name = tmp.to_string_lossy();
    let io = |e: std::io::Error| AppError::from_io(&e, &tmp_name);

    let meta = if let Some(ql_dir) = quick_look(path, cache_dir) {
        // Le dossier de Quick Look devient l'entrée telle quelle.
        let moved = fs::rename(&ql_dir, tmp);
        remove_parent(&ql_dir);
        moved.map_err(io)?;
        let html_path = tmp.join(HTML_NAME);
        let html = fs::read_to_string(&html_path).map_err(io)?;
        let width = sheet::quick_look_width(&html);
        let out = sheet::inject(&html, &sheet::sheet(width));
        fs::write(&html_path, out).map_err(io)?;
        Meta {
            slides: u32::try_from(html.matches("class=\"slide\"").count()).unwrap_or(u32::MAX),
            engine: RenderEngine::QuickLook,
        }
    } else {
        fs::create_dir(tmp).map_err(io)?;
        Meta {
            slides: render_simplified(path, tmp)?,
            engine: RenderEngine::Simplified,
        }
    };
    let json = serde_json::to_vec(&meta).map_err(|e| AppError::Io(e.to_string()))?;
    fs::write(tmp.join(META_NAME), json).map_err(io)
}

/// Lance Quick Look sur `path` dans un dossier de travail du cache. Rend le dossier
/// `*.qlpreview` qui contient `Preview.html`, ou `None` (rien produit, délai dépassé,
/// `qlmanage` absent). Le code de sortie ne compte pas : `qlmanage` rend 0 même en échec.
fn quick_look(path: &Path, cache_dir: &Path) -> Option<PathBuf> {
    if !Path::new(QLMANAGE).exists() {
        return None;
    }
    let work = cache_dir.join(format!("ql-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work).ok()?;
    let mut cmd = Command::new(QLMANAGE);
    cmd.args(["-p", "-o"])
        .arg(&work)
        .arg(path)
        .stdin(Stdio::null());
    let ran = run_with_timeout(cmd, None, QUICK_LOOK_TIMEOUT);
    let found = matches!(ran, Ok(Some(_)))
        .then(|| qlpreview_in(&work))
        .flatten();
    if found.is_none() {
        let _ = fs::remove_dir_all(&work);
    }
    found
}

fn qlpreview_in(work: &Path) -> Option<PathBuf> {
    fs::read_dir(work)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e == "qlpreview") && p.join(HTML_NAME).is_file())
}

/// Supprime le dossier de travail de Quick Look, parent du `*.qlpreview` déplacé.
fn remove_parent(moved: &Path) {
    if let Some(work) = moved.parent() {
        let _ = fs::remove_dir_all(work);
    }
}

/// Rendu d'une entrée complète (HTML et `render.json` lisibles), sinon `None`.
fn read_entry(entry: &Path) -> Option<PresentationRender> {
    let html = entry.join(HTML_NAME);
    if !html.is_file() {
        return None;
    }
    let meta: Meta = serde_json::from_slice(&fs::read(entry.join(META_NAME)).ok()?).ok()?;
    Some(PresentationRender {
        html: html.to_string_lossy().into_owned(),
        slides: meta.slides,
        engine: meta.engine,
    })
}

/// Met la date de modification du dossier à maintenant (ordre de la purge).
fn touch(dir: &Path) {
    if let Ok(f) = fs::File::open(dir) {
        let _ = f.set_modified(SystemTime::now());
    }
}

/// Garde `MAX_ENTRIES` entrées au plus, `keep` comprise : supprime les plus anciennes (date de
/// modification). Seuls les dossiers à nom de clé (16 chiffres hexadécimaux) sont comptés : un
/// rendu en cours (`<clé>.tmp-…`) n'est jamais touché.
fn evict(root: &Path, keep: &Path) {
    let Ok(read) = fs::read_dir(root) else {
        return;
    };
    let mut others: Vec<(SystemTime, PathBuf)> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let is_key = name.len() == 16 && name.bytes().all(|b| b.is_ascii_hexdigit());
            let modified = e.metadata().ok()?.modified().ok()?;
            (is_key && e.path() != keep && e.path().is_dir()).then(|| (modified, e.path()))
        })
        .collect();
    others.sort();
    let excess = others.len().saturating_sub(MAX_ENTRIES - 1);
    for (_, dir) in others.into_iter().take(excess) {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Clé de cache : hachage FNV-1a 64 bits du chemin et de la révision, en 16 chiffres
/// hexadécimaux. Stable d'un lancement à l'autre (`DefaultHasher` ne le garantit pas).
fn cache_key(path: &str, revision: &str) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0100_0000_01b3;
    let mut hash = OFFSET;
    // L'octet 0xFF sépare les deux champs : il n'apparaît jamais dans de l'UTF-8.
    for b in path.bytes().chain([0xFF]).chain(revision.bytes()) {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}
