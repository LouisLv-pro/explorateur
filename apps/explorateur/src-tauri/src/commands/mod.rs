//! Commandes appelées par le front : un fichier par fonctionnalité.
//! Chaque commande porte `#[tauri::command]` et `#[specta::specta]`, délègue à `core`,
//! et s'enregistre dans `collect_commands!` (lib.rs).

pub mod app;
pub mod apps;
pub mod browser;
pub mod default_app;
pub mod files;
pub mod folders;
pub mod git;
pub mod github;
pub mod last_read;
pub mod opened;
pub mod preview;
pub mod search;
pub mod servers;
pub mod terminal;
pub mod tree;
pub mod watch;
