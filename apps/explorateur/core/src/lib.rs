//! Logique métier de l'app. Aucune dépendance à Tauri : tout se teste avec `cargo test`.

pub mod apps;
pub mod browser;
pub mod db;
pub mod default_app;
pub mod error;
pub mod files;
pub mod folders;
pub mod git;
pub mod github;
pub mod last_read;
pub mod preview;
mod process;
pub mod search;
pub mod servers;
pub mod terminal;
pub mod tree;
pub mod watch;

pub use error::{AppError, Failure, Result};
