//! Menu de l'app. Le menu par défaut de Tauri associe ⌘W à « Fermer la fenêtre » : ici ⌘W est
//! « Fermer l'onglet », qui prévient le front par l'événement `close-tab`. ⌘S « Enregistrer »
//! émet `save-file`. « Quitter » est une entrée maison : avec des modifications non
//! enregistrées ou un processus en cours dans un terminal, elle demande confirmation au front
//! (`quit-requested`) au lieu de quitter. Le menu naît en anglais ; le front le rebâtit dans
//! sa langue par `set_language` (spec `langue-interface.md`). « Définir comme app par
//! défaut… » émet `default-app-requested` : le front ouvre son dialogue (spec
//! `app-par-defaut.md`).

use std::sync::atomic::Ordering;

use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

use crate::state::AppState;

/// Identifiant de l'entrée « Fermer l'onglet » et nom de l'événement émis vers le front.
const CLOSE_TAB: &str = "close-tab";
/// Identifiant de l'entrée « Enregistrer » et nom de l'événement émis vers le front.
const SAVE_FILE: &str = "save-file";
/// Identifiant de l'entrée « Quitter ».
const QUIT: &str = "quit";
/// Événement émis vers le front quand il faut confirmer la sortie.
pub const QUIT_REQUESTED: &str = "quit-requested";
/// Identifiant de l'entrée « Définir comme app par défaut… ».
const DEFAULT_APP: &str = "default-app";
/// Événement émis vers le front pour ouvrir le dialogue de l'app par défaut.
const DEFAULT_APP_REQUESTED: &str = "default-app-requested";

/// Langue du menu natif, choisie par le front (spec `langue-interface.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    En,
    Fr,
}

/// Textes du menu natif dans une langue. Les entrées prédéfinies reçoivent aussi leur texte :
/// sans lui, muda les écrit en anglais.
#[derive(Debug, Clone, Copy)]
pub struct MenuTexts {
    pub file: &'static str,
    pub edit: &'static str,
    pub window: &'static str,
    pub save: &'static str,
    pub close_tab: &'static str,
    pub quit: &'static str,
    pub about: &'static str,
    pub default_app: &'static str,
    pub services: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub fullscreen: &'static str,
}

/// Textes du menu natif dans `lang`.
pub const fn texts(lang: Lang) -> MenuTexts {
    match lang {
        Lang::En => MenuTexts {
            file: "File",
            edit: "Edit",
            window: "Window",
            save: "Save",
            close_tab: "Close Tab",
            quit: "Quit explorateur",
            about: "About explorateur",
            default_app: "Make Default for File Types…",
            services: "Services",
            hide: "Hide explorateur",
            hide_others: "Hide Others",
            show_all: "Show All",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            minimize: "Minimize",
            zoom: "Zoom",
            fullscreen: "Enter Full Screen",
        },
        Lang::Fr => MenuTexts {
            file: "Fichier",
            edit: "Édition",
            window: "Fenêtre",
            save: "Enregistrer",
            close_tab: "Fermer l'onglet",
            quit: "Quitter explorateur",
            about: "À propos d'explorateur",
            default_app: "Définir comme app par défaut…",
            services: "Services",
            hide: "Masquer explorateur",
            hide_others: "Masquer les autres",
            show_all: "Tout afficher",
            undo: "Annuler",
            redo: "Rétablir",
            cut: "Couper",
            copy: "Copier",
            paste: "Coller",
            select_all: "Tout sélectionner",
            minimize: "Placer dans le Dock",
            zoom: "Zoom",
            fullscreen: "Passer en plein écran",
        },
    }
}

/// Menu macOS : app (Quitter…), Fichier (Enregistrer, Fermer l'onglet), Édition, Fenêtre.
pub fn build(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<Wry>> {
    let t = texts(lang);
    let save = MenuItem::with_id(app, SAVE_FILE, t.save, true, Some("CmdOrCtrl+S"))?;
    let close_tab = MenuItem::with_id(app, CLOSE_TAB, t.close_tab, true, Some("CmdOrCtrl+W"))?;
    // Le « Quitter » prédéfini termine l'app sans passer par nous : entrée maison.
    let quit = MenuItem::with_id(app, QUIT, t.quit, true, Some("CmdOrCtrl+Q"))?;
    let default_app = MenuItem::with_id(app, DEFAULT_APP, t.default_app, true, None::<&str>)?;

    let app_menu = Submenu::with_items(
        app,
        "explorateur",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(t.about), None)?,
            &PredefinedMenuItem::separator(app)?,
            &default_app,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(t.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(t.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(t.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(t.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let file_menu = Submenu::with_items(app, t.file, true, &[&save, &close_tab])?;
    let edit_menu = Submenu::with_items(
        app,
        t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t.undo))?,
            &PredefinedMenuItem::redo(app, Some(t.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t.cut))?,
            &PredefinedMenuItem::copy(app, Some(t.copy))?,
            &PredefinedMenuItem::paste(app, Some(t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(t.select_all))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(t.zoom))?,
            &PredefinedMenuItem::fullscreen(app, Some(t.fullscreen))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

/// Transmet « Fermer l'onglet » et « Enregistrer » au front ; « Quitter » passe par
/// `request_quit`.
pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        CLOSE_TAB | SAVE_FILE => emit(app, id),
        DEFAULT_APP => emit(app, DEFAULT_APP_REQUESTED),
        QUIT => {
            if must_confirm_quit(app) {
                emit(app, QUIT_REQUESTED);
            } else {
                app.exit(0);
            }
        }
        _ => {}
    }
}

/// Vrai si quitter demande confirmation au front : modifications non enregistrées signalées
/// par le front, ou processus en cours dans un terminal (spec terminal.md).
pub fn must_confirm_quit(app: &AppHandle) -> bool {
    app.try_state::<AppState>().is_some_and(|state| {
        state.unsaved.load(Ordering::Relaxed) || !state.terminals.running_commands().is_empty()
    })
}

/// Émet l'événement `name` vers le front, sans charge utile.
pub fn emit(app: &AppHandle, name: &str) {
    if let Err(err) = app.emit(name, ()) {
        tracing::warn!("événement {name} non émis : {err}");
    }
}

/// Tests de la spec `langue-interface.md` : textes du menu natif par langue.
///
/// `serde_json` n'est pas une dépendance de ce crate : la désérialisation de `Lang` passe par
/// `IntoDeserializer` de serde, qui suit les mêmes attributs (`rename_all`) que le JSON de l'IPC.
#[cfg(test)]
mod tests {
    use serde::Deserialize as _;
    use serde::de::IntoDeserializer as _;
    use serde::de::value::{Error as DeError, StrDeserializer};

    use super::{Lang, MenuTexts, texts};

    /// Tous les champs de `MenuTexts`, nommés, pour que l'échec dise lequel est vide.
    fn fields(t: &MenuTexts) -> [(&'static str, &'static str); 21] {
        [
            ("file", t.file),
            ("edit", t.edit),
            ("window", t.window),
            ("save", t.save),
            ("close_tab", t.close_tab),
            ("quit", t.quit),
            ("about", t.about),
            ("default_app", t.default_app),
            ("services", t.services),
            ("hide", t.hide),
            ("hide_others", t.hide_others),
            ("show_all", t.show_all),
            ("undo", t.undo),
            ("redo", t.redo),
            ("cut", t.cut),
            ("copy", t.copy),
            ("paste", t.paste),
            ("select_all", t.select_all),
            ("minimize", t.minimize),
            ("zoom", t.zoom),
            ("fullscreen", t.fullscreen),
        ]
    }

    fn lang(value: &str) -> Result<Lang, DeError> {
        let de: StrDeserializer<'_, DeError> = value.into_deserializer();
        Lang::deserialize(de)
    }

    // Bug attrapé : une entrée laissée à "" (ou à des espaces) en anglais, qui donne une ligne
    // de menu vide.
    #[test]
    fn aucun_texte_du_menu_anglais_n_est_vide() {
        for (name, text) in fields(&texts(Lang::En)) {
            assert!(!text.trim().is_empty(), "Lang::En : champ {name} vide");
        }
    }

    // Bug attrapé : une entrée oubliée dans la colonne française, laissée à "".
    #[test]
    fn aucun_texte_du_menu_francais_n_est_vide() {
        for (name, text) in fields(&texts(Lang::Fr)) {
            assert!(!text.trim().is_empty(), "Lang::Fr : champ {name} vide");
        }
    }

    // Bug attrapé : `texts` qui ignore la langue et rend toujours le français (ou l'inverse).
    #[test]
    fn les_menus_principaux_suivent_la_langue() {
        let en = texts(Lang::En);
        let fr = texts(Lang::Fr);
        assert_eq!(en.file, "File");
        assert_eq!(fr.file, "Fichier");
        assert_eq!(en.edit, "Edit");
        assert_eq!(fr.edit, "Édition");
        assert_eq!(en.window, "Window");
        assert_eq!(fr.window, "Fenêtre");
    }

    // Bug attrapé : les entrées maison (Enregistrer, Fermer l'onglet, Quitter) laissées en
    // français dans la colonne anglaise.
    #[test]
    fn les_entrees_maison_different_entre_les_langues() {
        let en = texts(Lang::En);
        let fr = texts(Lang::Fr);
        assert_eq!(fr.save, "Enregistrer");
        assert_ne!(en.save, fr.save, "save");
        assert_ne!(en.close_tab, fr.close_tab, "close_tab");
        assert_ne!(en.quit, fr.quit, "quit");
    }

    // Bug attrapé : les entrées prédéfinies (Annuler, Copier…) laissées en anglais dans la
    // colonne française, alors que muda impose l'anglais sans texte explicite.
    #[test]
    fn les_entrees_predefinies_sont_traduites_en_francais() {
        let en = fields(&texts(Lang::En));
        let fr = fields(&texts(Lang::Fr));
        for name in ["undo", "redo", "cut", "copy", "paste", "select_all"] {
            let en_text = en.iter().find(|(n, _)| *n == name).map(|(_, t)| *t);
            let fr_text = fr.iter().find(|(n, _)| *n == name).map(|(_, t)| *t);
            assert_ne!(en_text, fr_text, "{name} identique dans les deux langues");
        }
    }

    // Bug attrapé : « Définir comme app par défaut… » laissé en anglais (spec
    // `app-par-defaut.md`).
    #[test]
    fn l_entree_app_par_defaut_suit_la_langue() {
        assert_eq!(texts(Lang::En).default_app, "Make Default for File Types…");
        assert_eq!(texts(Lang::Fr).default_app, "Définir comme app par défaut…");
    }

    // Bug attrapé : le nom de l'app traduit ou oublié dans « Quitter explorateur ».
    #[test]
    fn quitter_nomme_l_app_dans_les_deux_langues() {
        assert!(texts(Lang::En).quit.contains("explorateur"));
        assert!(texts(Lang::Fr).quit.contains("explorateur"));
    }

    // Bug attrapé : `rename_all` oublié, le front envoie "en" et Rust attend "En".
    #[test]
    fn lang_se_lit_depuis_en_et_fr_en_minuscules() {
        assert!(matches!(lang("en"), Ok(Lang::En)));
        assert!(matches!(lang("fr"), Ok(Lang::Fr)));
    }

    // Bug attrapé : une valeur du front (`system`, `de`) acceptée en silence comme une langue.
    #[test]
    fn lang_refuse_une_valeur_inconnue() {
        assert!(lang("system").is_err());
        assert!(lang("de").is_err());
        assert!(lang("En").is_err());
    }
}
