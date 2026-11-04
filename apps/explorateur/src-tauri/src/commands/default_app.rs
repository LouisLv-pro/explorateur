//! App par défaut d'un type de fichier (spec `app-par-defaut.md`). macOS demande une
//! confirmation par type (UTI) : le front envoie les demandes une à une par `set_default_app`.
//! Les appels à AppKit passent par le fil principal ; leurs résultats reviennent par un canal.
//! Aucun `unsafe` : toutes les méthodes utilisées sont sûres dans `objc2`.

use explorateur_core::{AppError, default_app::GroupStatus};

/// État de chaque groupe : types distincts, déjà à explorateur, et ceux qui restent à demander.
#[tauri::command]
#[specta::specta]
pub async fn default_app_status(app: tauri::AppHandle) -> Result<Vec<GroupStatus>, AppError> {
    imp::default_app_status(&app).await
}

/// Demande à macOS de faire d'explorateur l'app par défaut de `uti`. Attend la réponse de
/// l'utilisateur, puis relit l'état : `true` si explorateur ouvre désormais ce type. Un refus
/// rend `false`, pas une erreur.
#[tauri::command]
#[specta::specta]
pub async fn set_default_app(app: tauri::AppHandle, uti: String) -> Result<bool, AppError> {
    imp::set_default_app(&app, uti).await
}

#[cfg(target_os = "macos")]
mod imp {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use block2::RcBlock;
    use explorateur_core::{
        AppError, Failure,
        default_app::{self, GROUPS, GroupStatus, TypeStatus},
    };
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;
    use tauri::AppHandle;
    use tokio::sync::oneshot;

    pub async fn default_app_status(app: &AppHandle) -> Result<Vec<GroupStatus>, AppError> {
        let statuses = on_main_thread(app, || {
            let bundle = running_bundle()?;
            Ok::<_, AppError>(read_statuses(&bundle))
        })
        .await??;
        Ok(default_app::group_statuses(&statuses))
    }

    pub async fn set_default_app(app: &AppHandle, uti: String) -> Result<bool, AppError> {
        let bundle = on_main_thread(app, running_bundle).await??;
        let (done_tx, done_rx) = oneshot::channel::<()>();
        let request = {
            let bundle = bundle.clone();
            let uti = uti.clone();
            move || request_default(&bundle, &uti, done_tx)
        };
        on_main_thread(app, request).await??;
        // Le gestionnaire de fin n'est appelé qu'après la réponse de l'utilisateur, donc sans
        // délai d'attente. Un canal fermé sans appel compte aussi comme une réponse : l'état
        // relu dit ce qu'il en est.
        let _answered = done_rx.await;
        on_main_thread(app, move || is_default_for(&bundle, &uti)).await?
    }

    /// Exécute `f` sur le fil principal et en rend le résultat. Seules des valeurs `Send`
    /// (chemins, textes) en sortent : les objets AppKit restent sur ce fil.
    async fn on_main_thread<T, F>(app: &AppHandle, f: F) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let (tx, rx) = oneshot::channel();
        app.run_on_main_thread(move || {
            // Commande abandonnée entre-temps : personne n'attend le résultat.
            let _sent = tx.send(f());
        })
        .map_err(Failure::interrupted)?;
        rx.await.map_err(Failure::interrupted)
    }

    /// Paquet `.app` en cours d'exécution, ou `NotBundled` (`tauri dev`).
    fn running_bundle() -> Result<PathBuf, AppError> {
        bundle_path(NSBundle::mainBundle().bundleURL().to_file_path())
    }

    /// Garde le chemin du paquet s'il finit par `.app`.
    fn bundle_path(path: Option<PathBuf>) -> Result<PathBuf, AppError> {
        match path {
            Some(path) if path.extension().is_some_and(|ext| ext == "app") => Ok(path),
            _ => Err(AppError::NotBundled),
        }
    }

    /// Vrai si `default` (app qui ouvre un type) est le paquet `bundle`, chemins normalisés
    /// (liens symboliques, `..`). Un chemin illisible ne correspond pas.
    fn is_same_app(default: Option<&Path>, bundle: &Path) -> bool {
        let Some(default) = default else {
            return false;
        };
        match (
            std::fs::canonicalize(default),
            std::fs::canonicalize(bundle),
        ) {
            (Ok(default), Ok(bundle)) => default == bundle,
            _ => false,
        }
    }

    /// UTI de chaque extension de la table, et si `bundle` l'ouvre déjà. Une extension sans
    /// type connu de macOS est sautée. Fil principal.
    fn read_statuses(bundle: &Path) -> Vec<TypeStatus> {
        let workspace = NSWorkspace::sharedWorkspace();
        GROUPS
            .iter()
            .flat_map(|(_, exts)| exts.iter())
            .filter_map(|ext| {
                let content_type = UTType::typeWithFilenameExtension(&NSString::from_str(ext))?;
                Some(TypeStatus {
                    ext: (*ext).to_owned(),
                    uti: content_type.identifier().to_string(),
                    is_default: opens_with(&workspace, &content_type, bundle),
                })
            })
            .collect()
    }

    /// Vrai si l'app qui ouvre `content_type` est `bundle`. Fil principal.
    fn opens_with(workspace: &NSWorkspace, content_type: &UTType, bundle: &Path) -> bool {
        let default = workspace
            .URLForApplicationToOpenContentType(content_type)
            .and_then(|url| url.to_file_path());
        is_same_app(default.as_deref(), bundle)
    }

    /// Type de `uti`, ou `NotFound` s'il est inconnu de macOS.
    fn content_type(uti: &str) -> Result<objc2::rc::Retained<UTType>, AppError> {
        UTType::typeWithIdentifier(&NSString::from_str(uti))
            .ok_or_else(|| AppError::NotFound(uti.to_owned()))
    }

    /// Relit si `bundle` ouvre `uti`. Fil principal.
    fn is_default_for(bundle: &Path, uti: &str) -> Result<bool, AppError> {
        let content_type = content_type(uti)?;
        Ok(opens_with(
            &NSWorkspace::sharedWorkspace(),
            &content_type,
            bundle,
        ))
    }

    /// Envoie la demande à macOS ; `done` reçoit un signal quand l'utilisateur a répondu.
    /// Fil principal.
    fn request_default(
        bundle: &Path,
        uti: &str,
        done: oneshot::Sender<()>,
    ) -> Result<(), AppError> {
        let content_type = content_type(uti)?;
        let app_url = NSURL::from_directory_path(bundle)
            .ok_or_else(|| AppError::NotFound(bundle.display().to_string()))?;
        // Le bloc est `Fn` et `send` consomme l'envoyeur : il attend dans un `Option`.
        let done = Mutex::new(Some(done));
        let uti = uti.to_owned();
        let handler = RcBlock::new(move |error: *mut NSError| {
            if !error.is_null() {
                tracing::info!("app par défaut de {uti} : refusée ou en échec");
            }
            if let Some(tx) = done.lock().ok().and_then(|mut slot| slot.take()) {
                let _sent = tx.send(());
            }
        });
        // AppKit retient le bloc jusqu'à son appel : `handler` peut tomber à la fin.
        NSWorkspace::sharedWorkspace()
            .setDefaultApplicationAtURL_toOpenContentType_completionHandler(
                &app_url,
                &content_type,
                Some(&*handler),
            );
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use std::path::{Path, PathBuf};

        use explorateur_core::AppError;

        use super::{bundle_path, is_same_app};

        // Bug attrapé : `tauri dev` (binaire nu dans target/debug) pris pour un paquet.
        #[test]
        fn un_binaire_hors_paquet_rend_not_bundled() {
            let result = bundle_path(Some(PathBuf::from("/Users/moi/target/debug")));
            assert!(matches!(result, Err(AppError::NotBundled)));
            assert!(matches!(bundle_path(None), Err(AppError::NotBundled)));
        }

        #[test]
        fn un_paquet_app_est_garde_tel_quel() {
            let path = PathBuf::from("/Applications/explorateur.app");
            assert_eq!(bundle_path(Some(path.clone())).ok(), Some(path));
        }

        // Bug attrapé : comparaison des chemins bruts, qui ne reconnaît pas un même dossier
        // écrit autrement.
        #[test]
        fn un_meme_dossier_ecrit_autrement_est_la_meme_app() {
            let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
            let detour = dir.join("src").join("..");
            assert!(is_same_app(Some(&detour), dir));
        }

        #[test]
        fn une_autre_app_ou_aucune_ne_correspond_pas() {
            let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
            assert!(!is_same_app(Some(&dir.join("src")), dir));
            assert!(!is_same_app(None, dir));
            assert!(!is_same_app(Some(Path::new("/nexiste/pas.app")), dir));
        }
    }
}

/// Hors macOS, aucune app par défaut à régler.
#[cfg(not(target_os = "macos"))]
mod imp {
    use explorateur_core::{AppError, default_app::GroupStatus};
    use tauri::AppHandle;

    pub async fn default_app_status(_app: &AppHandle) -> Result<Vec<GroupStatus>, AppError> {
        Err(AppError::NotBundled)
    }

    pub async fn set_default_app(_app: &AppHandle, _uti: String) -> Result<bool, AppError> {
        Err(AppError::NotBundled)
    }
}
