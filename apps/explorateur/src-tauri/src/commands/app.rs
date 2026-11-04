//! Sortie de l'app : ⌘Q et la fermeture de la fenêtre passent par le front quand des onglets
//! ont des modifications non enregistrées (spec editeur.md) ou qu'un terminal a un processus
//! en cours (spec terminal.md, voir `menu::must_confirm_quit`).

use std::sync::atomic::Ordering;

use explorateur_core::{AppError, Failure};
use tauri::State;

use crate::menu::{self, Lang};
use crate::state::AppState;

/// Le front signale s'il reste des modifications non enregistrées.
#[tauri::command]
#[specta::specta]
pub fn set_unsaved_changes(state: State<'_, AppState>, unsaved: bool) {
    state.unsaved.store(unsaved, Ordering::Relaxed);
}

/// Rebâtit le menu natif dans la langue de l'interface (spec `langue-interface.md`).
#[tauri::command]
#[specta::specta]
pub fn set_language(app: tauri::AppHandle, lang: Lang) -> Result<(), AppError> {
    let to_error = |err: tauri::Error| AppError::from(Failure::NativeMenu(err.to_string()));
    let menu = menu::build(&app, lang).map_err(to_error)?;
    app.set_menu(menu).map_err(to_error)?;
    Ok(())
}

/// Quitte l'app sans autre question (« Quitter sans enregistrer »).
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
