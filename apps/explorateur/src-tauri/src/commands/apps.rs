//! Apps natives (spec apps-natives.md, décision 0009) : détection, simulateurs et commande
//! de lancement Xcode. Le lancement lui-même passe par une page du terminal (front).

use std::{path::PathBuf, sync::Arc};

use explorateur_core::{
    AppError, Failure,
    apps::{
        self, AndroidDevice, AppKind, AppTarget, DeviceSource, FlutterDeviceCache, FlutterDevices,
        NativeApp, Simulator,
    },
};
use tauri::{AppHandle, Manager, State};

use super::git::user_git;

/// Parcours du disque : sur un fil réservé aux tâches bloquantes (`spawn_blocking`).
#[tauri::command]
#[specta::specta]
pub async fn detect_apps(root: String) -> Result<Vec<NativeApp>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        apps::detect_apps_git(&user_git(), &PathBuf::from(root))
    })
    .await
    .map_err(Failure::interrupted)
}

/// Simulateurs disponibles de toutes les plateformes (`xcrun simctl list devices available -j`,
/// sans shell) ; le front filtre par `platform`. Xcode absent ou `simctl` en échec : erreur,
/// que le menu affiche « Xcode introuvable ».
#[tauri::command]
#[specta::specta]
pub async fn list_simulators() -> Result<Vec<Simulator>, AppError> {
    tauri::async_runtime::spawn_blocking(apps::list_all_simulators)
        .await
        .map_err(Failure::interrupted)?
}

/// Émulateurs et appareils Android branchés (spec apps-android.md), sans shell. SDK introuvable
/// ou `adb` en échec : erreur, que le menu affiche « SDK Android introuvable ».
#[tauri::command]
#[specta::specta]
pub async fn list_android_devices() -> Result<Vec<AndroidDevice>, AppError> {
    tauri::async_runtime::spawn_blocking(|| apps::list_android_devices(&android_sdk()?))
        .await
        .map_err(Failure::interrupted)?
}

fn android_sdk() -> Result<PathBuf, AppError> {
    apps::android_sdk().ok_or_else(|| Failure::AndroidSdkNotFound.into())
}

/// Commande d'une cible Android, Expo ou React Native. Android : la liste des appareils est
/// relue pour connaître l'état de `device_id` (démarré ou non) et un port libre d'émulateur.
fn mobile_command(target: &AppTarget, device_id: Option<&str>) -> Result<String, AppError> {
    if target.device_source == Some(DeviceSource::IosSimulators) {
        return Ok(apps::react_native_ios_command(target, device_id));
    }
    let sdk = android_sdk()?;
    let devices = apps::list_android_devices(&sdk)?;
    let device = devices
        .iter()
        .find(|d| Some(d.id.as_str()) == device_id)
        .ok_or(Failure::AndroidDeviceNotFound)?;
    let port = apps::free_emulator_port(&devices);
    Ok(if target.kind == AppKind::Android {
        apps::android_command(target, device, &sdk, port)
    } else {
        apps::react_native_android_command(target, device, &sdk, port)
    })
}

/// Commande qui lance une cible (décision 0020) : sa commande fixe si elle en a une, sinon
/// construite selon son genre. `device_id` : appareil choisi dans le sélecteur (simulateur
/// Apple, appareil Android). Xcode : cache de compilation dans le dossier cache de l'app
/// (`~/Library/Caches/<identifier>/DerivedData/`). Asynchrone : Android interroge `adb`.
#[tauri::command]
#[specta::specta]
pub async fn get_app_command(
    app: AppHandle,
    target: AppTarget,
    device_id: Option<String>,
) -> Result<String, AppError> {
    if let Some(command) = target.command {
        return Ok(command);
    }
    match target.kind {
        AppKind::Ios
        | AppKind::Watchos
        | AppKind::Tvos
        | AppKind::Visionos
        | AppKind::Macos
        | AppKind::Catalyst => {
            let cache_root = app
                .path()
                .app_cache_dir()
                .map_err(|e| Failure::CacheDirNotFound(e.to_string()))?;
            Ok(apps::xcode_command(
                &target,
                device_id.as_deref(),
                &cache_root,
            ))
        }
        AppKind::Android | AppKind::Expo | AppKind::ReactNative => {
            tauri::async_runtime::spawn_blocking(move || {
                mobile_command(&target, device_id.as_deref())
            })
            .await
            .map_err(Failure::interrupted)?
        }
        // Flutter : commande par `get_flutter_command` (elle a besoin du dossier de l'app).
        AppKind::Tauri | AppKind::Electron | AppKind::Rust | AppKind::Swift | AppKind::Flutter => {
            Err(Failure::NoCommand(target.label).into())
        }
    }
}

/// Appareils Flutter de l'app de `dir` (décision 0022) : `flutter devices` est lu au plus
/// toutes les 15 s, ou tout de suite si `refresh` (bouton Actualiser). Flutter introuvable :
/// `flutter_found` faux. Processus externe lent : sur un fil réservé aux tâches bloquantes.
#[tauri::command]
#[specta::specta]
pub async fn list_flutter_devices(
    cache: State<'_, Arc<FlutterDeviceCache>>,
    dir: String,
    refresh: bool,
) -> Result<FlutterDevices, AppError> {
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || cache.devices_for(&PathBuf::from(dir), refresh))
        .await
        .map_err(Failure::interrupted)?
}

/// Commande qui lance l'app Flutter de `dir` sur l'appareil choisi : `<flutter> run -d <id>`.
#[tauri::command]
#[specta::specta]
pub fn get_flutter_command(dir: String, device_id: String) -> Result<String, AppError> {
    let flutter = apps::find_flutter(&PathBuf::from(dir)).ok_or(Failure::FlutterNotFound)?;
    Ok(apps::flutter_command(&flutter, &device_id))
}
