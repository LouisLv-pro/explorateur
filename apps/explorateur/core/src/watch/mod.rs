//! Surveillance du dossier racine (spec `rechargement-auto.md`, décision 0002).
//!
//! `notify` (FSEvents sur macOS) remonte des événements bruts ; un fil de fond les regroupe
//! par fenêtre de 200 ms, les filtre avec `classify_changes`, puis appelle `on_change`.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::{AppError, Result};

/// Fenêtre de regroupement des événements bruts.
const DEBOUNCE: Duration = Duration::from_millis(200);
/// Dossiers dont les changements sont ignorés (bruit d'un build ou d'un commit).
const IGNORED_DIRS: [&str; 4] = [".git", "node_modules", "target", "__pycache__"];

/// Lot de changements sur le disque. Chemins absolus, triés, sans doublon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DiskChange {
    /// Chemins touchés (créés, modifiés, supprimés, renommés).
    pub files: Vec<String>,
    /// Dossiers parents de ces chemins, dont la liste a pu changer.
    pub dirs: Vec<String>,
}

/// Garde les chemins sous `root` hors des dossiers ignorés, avec leurs dossiers parents.
/// `None` si plus rien ne reste.
pub fn classify_changes(root: &Path, paths: &[PathBuf]) -> Option<DiskChange> {
    let mut files = BTreeSet::new();
    let mut dirs = BTreeSet::new();
    for path in paths {
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let ignored = relative.components().any(|c| match c {
            Component::Normal(name) => IGNORED_DIRS.iter().any(|d| name == *d),
            _ => false,
        });
        if ignored || relative.as_os_str().is_empty() {
            continue;
        }
        files.insert(path.to_string_lossy().into_owned());
        if let Some(parent) = path.parent() {
            dirs.insert(parent.to_string_lossy().into_owned());
        }
    }
    if files.is_empty() {
        return None;
    }
    Some(DiskChange {
        files: files.into_iter().collect(),
        dirs: dirs.into_iter().collect(),
    })
}

/// Surveillance récursive d'un dossier racine. La lâcher (`drop`) l'arrête.
pub struct RootWatcher {
    _watcher: RecommendedWatcher,
    stopped: Arc<AtomicBool>,
}

impl RootWatcher {
    /// Surveille `root` ; `on_change` est appelé sur un fil de fond, une fois par lot non vide.
    pub fn start(root: &str, on_change: impl Fn(DiskChange) + Send + 'static) -> Result<Self> {
        let meta = fs::metadata(root).map_err(|e| AppError::from_io(&e, root))?;
        if !meta.is_dir() {
            return Err(AppError::NotADirectory(root.to_owned()));
        }
        // FSEvents renvoie des chemins canoniques (`/private/var/…` pour `/var/…`) : on compare
        // avec la racine canonique, puis on rend les chemins sous la racine demandée.
        let given = PathBuf::from(root);
        let canonical = given
            .canonicalize()
            .map_err(|e| AppError::from_io(&e, root))?;

        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher =
            notify::recommended_watcher(tx).map_err(|e| AppError::Io(format!("{root}: {e}")))?;
        watcher
            .watch(&canonical, RecursiveMode::Recursive)
            .map_err(|e| AppError::Io(format!("{root}: {e}")))?;

        let stopped = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stopped);
        thread::spawn(move || {
            batch_loop(&rx, &canonical, &given, &flag, &on_change);
        });
        Ok(Self {
            _watcher: watcher,
            stopped,
        })
    }
}

impl Drop for RootWatcher {
    fn drop(&mut self) {
        // Le watcher lâché ferme le canal et termine le fil ; le drapeau empêche un lot déjà
        // en cours d'être livré.
        self.stopped.store(true, Ordering::SeqCst);
    }
}

/// Regroupe les événements par fenêtre de `DEBOUNCE` et livre chaque lot non vide.
fn batch_loop(
    rx: &Receiver<notify::Result<notify::Event>>,
    canonical: &Path,
    given: &Path,
    stopped: &AtomicBool,
    on_change: &impl Fn(DiskChange),
) {
    // `recv` échoue quand le watcher est lâché : le fil s'arrête.
    while let Ok(first) = rx.recv() {
        let mut paths = Vec::new();
        collect(first, &mut paths);
        let deadline = Instant::now() + DEBOUNCE;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(event) => collect(event, &mut paths),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        let paths: Vec<PathBuf> = paths
            .into_iter()
            .filter_map(|p| p.strip_prefix(canonical).ok().map(|rel| given.join(rel)))
            .collect();
        if let Some(change) = classify_changes(given, &paths) {
            on_change(change);
        }
    }
}

fn collect(event: notify::Result<notify::Event>, paths: &mut Vec<PathBuf>) {
    match event {
        Ok(event) => paths.extend(event.paths),
        Err(err) => tracing::warn!("surveillance du disque : {err}"),
    }
}
