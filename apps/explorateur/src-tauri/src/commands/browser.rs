//! Navigateur intégré (spec navigateur.md, décision 0011) : une webview native enfant de la
//! fenêtre principale par onglet, rangée dans `AppState.browser` sous l'identifiant choisi par
//! le front. Le front place la webview active (`browser_layout`) et reçoit en retour l'URL, le
//! titre et l'état de chargement par événements. Aucune capability `remote` : une page externe
//! n'a pas accès à l'IPC (Tauri refuse toute commande venue d'une origine non locale).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use explorateur_core::{
    AppError, Failure,
    browser::{UrlError, normalize_url},
};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, State, Url, Webview, WebviewUrl,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};
use tauri_specta::Event;

use crate::state::AppState;

/// Webviews vivantes, par identifiant d'onglet, et dernière disposition envoyée par le front.
#[derive(Default)]
pub struct BrowserTabs(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    webviews: HashMap<String, Webview>,
    layout: Option<BrowserLayout>,
}

impl BrowserTabs {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn webview(&self, id: &str) -> Result<Webview, AppError> {
        self.lock()
            .webviews
            .get(id)
            .cloned()
            .ok_or_else(|| Failure::UnknownTab(id.to_string()).into())
    }
}

/// Où poser la webview de l'onglet `active` (coordonnées logiques de la fenêtre, origine en
/// haut à gauche). `active` vide : toutes les webviews sont masquées (panneau fermé, calque
/// de l'app ouvert, onglet vide).
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLayout {
    pub active: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Hauteur de la page de l'app (`window.innerHeight`) : sert à `content_offset`.
    pub viewport_height: f64,
}

/// L'adresse d'un onglet a changé (navigation, lien cliqué, fin de chargement).
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct BrowserNavigated {
    pub id: String,
    pub url: String,
}

/// Le titre de la page d'un onglet a changé.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct BrowserTitleChanged {
    pub id: String,
    pub title: String,
}

/// Un onglet commence ou finit de charger une page.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct BrowserLoading {
    pub id: String,
    pub loading: bool,
}

/// Une page demande une nouvelle fenêtre (`target="_blank"`, `window.open`) : le front l'ouvre
/// dans un nouvel onglet.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct BrowserNewTab {
    pub url: String,
}

fn emit<E: Event + Serialize + Clone>(app: &AppHandle, event: &E) {
    if let Err(err) = event.emit(app) {
        tracing::warn!("événement du navigateur non émis : {err}");
    }
}

/// Une webview ne charge que du web : `file:`, `asset:`, `preview:` ou `tauri:` donneraient à une
/// page externe un accès local (ou, pour les protocoles de l'app, une origine locale à l'IPC).
fn is_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

fn browser_error(err: &tauri::Error) -> AppError {
    AppError::Browser(err.to_string())
}

/// Étiquette de la webview : l'identifiant du front, restreint à ce que Tauri accepte.
fn label_of(id: &str) -> Result<String, AppError> {
    let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(format!("browser-{id}"))
    } else {
        Err(Failure::UnknownTab(id.to_string()).into())
    }
}

fn build_webview(app: &AppHandle, id: &str, url: Url) -> Result<Webview, AppError> {
    let window = app.get_window("main").ok_or(Failure::MainWindowNotFound)?;
    let (nav_app, nav_id) = (app.clone(), id.to_owned());
    let (load_app, load_id) = (app.clone(), id.to_owned());
    let (title_app, title_id) = (app.clone(), id.to_owned());
    let new_app = app.clone();
    let builder = WebviewBuilder::new(label_of(id)?, WebviewUrl::External(url))
        .on_navigation(move |url| {
            let allowed = is_allowed(url);
            if allowed && url.scheme() != "about" {
                let event = BrowserNavigated {
                    id: nav_id.clone(),
                    url: url.to_string(),
                };
                emit(&nav_app, &event);
            }
            allowed
        })
        .on_page_load(move |_webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            if is_allowed(payload.url()) && payload.url().scheme() != "about" {
                let event = BrowserNavigated {
                    id: load_id.clone(),
                    url: payload.url().to_string(),
                };
                emit(&load_app, &event);
            }
            let event = BrowserLoading {
                id: load_id.clone(),
                loading,
            };
            emit(&load_app, &event);
        })
        .on_document_title_changed(move |webview, title| {
            // Une page à une seule vue (SPA) change d'adresse sans recharger : le titre suit.
            if let Ok(url) = webview.url()
                && is_allowed(&url)
                && url.scheme() != "about"
            {
                let event = BrowserNavigated {
                    id: title_id.clone(),
                    url: url.to_string(),
                };
                emit(&title_app, &event);
            }
            let event = BrowserTitleChanged {
                id: title_id.clone(),
                title,
            };
            emit(&title_app, &event);
        })
        .on_new_window(move |url, _features| {
            if is_allowed(&url) {
                emit(
                    &new_app,
                    &BrowserNewTab {
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|err| browser_error(&err))
}

/// Décalage entre l'origine de la page de l'app (le `0, 0` des coordonnées CSS que mesure le
/// front) et l'origine où wry place une webview enfant : le coin haut gauche de la vue de contenu
/// de la fenêtre. Sur macOS, wry retourne l'axe vertical avec la hauteur de cette vue ; si la page
/// de l'app n'en occupe pas toute la hauteur (webview principale décalée, ou page rognée d'un
/// retrait en haut comme la barre de titre), la webview enfant se retrouve trop haut de cet écart.
/// Il est lu sur la webview principale, sans valeur fixe : décalage haut de son cadre, plus la
/// hauteur de cadre que la page ne couvre pas (`viewport_height`, `window.innerHeight`).
fn content_offset(inner: &Inner, layout: &BrowserLayout) -> (f64, f64) {
    let Some(main) = inner
        .webviews
        .values()
        .next()
        .and_then(|webview| webview.app_handle().get_webview("main"))
    else {
        return (0.0, 0.0);
    };
    let scale = main.window().scale_factor().unwrap_or(1.0);
    let Ok(bounds) = main.bounds() else {
        return (0.0, 0.0);
    };
    let position = bounds.position.to_logical::<f64>(scale);
    let size = bounds.size.to_logical::<f64>(scale);
    let uncovered = (size.height - layout.viewport_height).max(0.0);
    // Sous le pixel : arrondis, pas un retrait.
    let clean = |value: f64| if value < 1.0 { 0.0 } else { value };
    (clean(position.x), clean(position.y + uncovered))
}

/// Pose la webview active à sa place et masque les autres.
fn apply_layout(inner: &Inner) {
    let Some(layout) = &inner.layout else { return };
    let (offset_x, offset_y) = content_offset(inner, layout);
    for (id, webview) in &inner.webviews {
        let shown =
            layout.active.as_deref() == Some(id) && layout.width >= 1.0 && layout.height >= 1.0;
        let result = if shown {
            let bounds = Rect {
                position: LogicalPosition::new(layout.x + offset_x, layout.y + offset_y).into(),
                size: LogicalSize::new(layout.width, layout.height).into(),
            };
            webview.set_bounds(bounds).and_then(|()| webview.show())
        } else {
            webview.hide()
        };
        if let Err(err) = result {
            tracing::warn!("webview {id} non placée : {err}");
        }
    }
}

/// Charge la saisie du champ d'URL dans l'onglet `id` (la webview est créée au premier
/// chargement). Renvoie l'adresse chargée.
#[tauri::command]
#[specta::specta]
pub async fn browser_navigate(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    input: String,
) -> Result<String, AppError> {
    let url = normalize_url(&input)?;
    let parsed: Url = url
        .parse()
        .map_err(|_| AppError::InvalidUrl(UrlError::Unreadable))?;
    let existing = state.browser.lock().webviews.get(&id).cloned();
    if let Some(webview) = existing {
        webview
            .navigate(parsed)
            .map_err(|err| browser_error(&err))?;
        return Ok(url);
    }
    let webview = build_webview(&app, &id, parsed)?;
    let mut inner = state.browser.lock();
    inner.webviews.insert(id, webview);
    apply_layout(&inner);
    Ok(url)
}

/// Place la webview de l'onglet actif (coordonnées logiques) et masque les autres.
#[tauri::command]
#[specta::specta]
pub async fn browser_layout(
    state: State<'_, AppState>,
    layout: BrowserLayout,
) -> Result<(), AppError> {
    let mut inner = state.browser.lock();
    inner.layout = Some(layout);
    apply_layout(&inner);
    Ok(())
}

/// Ferme la webview de l'onglet `id` (sans effet si l'onglet est vide).
#[tauri::command]
#[specta::specta]
pub async fn browser_close(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let removed = state.browser.lock().webviews.remove(&id);
    if let Some(webview) = removed {
        webview.close().map_err(|err| browser_error(&err))?;
    }
    Ok(())
}

/// Page précédente de l'historique de l'onglet.
#[tauri::command]
#[specta::specta]
pub async fn browser_back(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let webview = state.browser.webview(&id)?;
    webview
        .eval("history.back()")
        .map_err(|err| browser_error(&err))
}

/// Page suivante de l'historique de l'onglet.
#[tauri::command]
#[specta::specta]
pub async fn browser_forward(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let webview = state.browser.webview(&id)?;
    webview
        .eval("history.forward()")
        .map_err(|err| browser_error(&err))
}

/// Recharge la page de l'onglet (réessaie après une erreur de chargement).
#[tauri::command]
#[specta::specta]
pub async fn browser_reload(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let webview = state.browser.webview(&id)?;
    webview.reload().map_err(|err| browser_error(&err))
}
