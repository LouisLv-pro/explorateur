use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use explorateur_core::{db::Db, last_read::ReadTracker, watch::RootWatcher};

use crate::commands::{browser::BrowserTabs, notebook::Notebooks, terminal::TerminalSessions};

/// État partagé par les commandes, injecté via `tauri::State<AppState>`.
pub struct AppState {
    pub db: Db,
    /// Surveillance du dossier racine ouvert : une seule à la fois (décision 0002).
    pub watcher: Mutex<Option<RootWatcher>>,
    /// Vrai si un onglet a des modifications non enregistrées (tenu à jour par le front) :
    /// ⌘Q et la fermeture de la fenêtre demandent alors confirmation au front (`menu.rs`).
    pub unsaved: AtomicBool,
    /// Shells du terminal intégré, par page (spec terminal.md) ; tous fermés à la sortie.
    pub terminals: TerminalSessions,
    /// Webviews du navigateur intégré, par onglet (spec navigateur.md).
    pub browser: BrowserTabs,
    /// Versions lues et pastilles « modifié depuis votre dernière lecture » (spec
    /// derniere-lecture.md), en mémoire pour la session.
    pub reads: Mutex<ReadTracker>,
    /// Noyaux Jupyter des notebooks ouverts (spec notebook.md) ; tous arrêtés à la sortie et au
    /// changement de dossier racine.
    pub notebooks: Notebooks,
}
