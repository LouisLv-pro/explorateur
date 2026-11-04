// Apps natives (spec apps-natives.md et menu-apps-allege.md, décision 0020 ; glossaire :
// NativeApp, AppTarget, DeviceSource, AppStatus, Simulator) : état d'une cible, gestes
// proposés, appareil choisi et compteur du bouton. Fonctions pures.
import type {
  AndroidDevice,
  AppTarget,
  DeviceSource,
  FlutterDevice,
  NativeApp,
  SimPlatform,
  Simulator,
} from "@/bindings";
import i18n from "@/i18n";
import type { ServerRun } from "./model";

/** `stopped` (Arrêtée), `running` (En cours : sa page exécute la commande, compilation comprise). */
export type AppStatus = "stopped" | "running";

/** Cible lancée depuis l'app : sa page de terminal. */
export type AppRun = {
  /** `targetKey(app, target)`. */
  key: string;
  app: NativeApp;
  target: AppTarget;
  /** Dossier racine ouvert au lancement (section « Autres dossiers » après un changement). */
  rootPath: string;
  pageId: number;
  /** La page a été vue avec un processus en cours : sa fin ramène la cible à Arrêtée. */
  seenRunning: boolean;
  /** `Date.now()` au lancement. */
  startedAt: number;
};

/** Clé stable d'une app : projet (ou dossier) et nom. */
function appIdentity(app: Pick<NativeApp, "dir" | "name">, target: Pick<AppTarget, "project">) {
  return `app:${target.project ?? app.dir}::${app.name}`;
}

/** Clé d'exécution d'une cible : projet (ou dossier), nom de l'app et identifiant de la cible. */
export function targetKey(
  app: Pick<NativeApp, "dir" | "name">,
  target: Pick<AppTarget, "project" | "id">,
): string {
  return `${appIdentity(app, target)}::${target.id}`;
}

/** Titre de la page de terminal et base des infobulles : « NimbusDemo · iOS ». */
export function targetLabel(app: Pick<NativeApp, "name">, target: Pick<AppTarget, "label">) {
  return `${app.name} · ${target.label}`;
}

/** Sous-titre d'une app : son dossier relatif, rien à la racine (comme un serveur). */
export function appSubtitle(app: Pick<NativeApp, "relativeDir">): string | null {
  return app.relativeDir === "." ? null : app.relativeDir;
}

/** Libellés du sélecteur d'une source d'appareils : nom accessible, liste vide et ses aides. */
export type DeviceSourceText = {
  title: string;
  empty: string;
  /** Aide sous la ligne quand la liste est vide. */
  emptyHelp: string | null;
  /** Liste vide : le runtime de la plateforme s'installe dans Xcode (infobulle). */
  runtimeHelp: boolean;
};

/** Textes d'une source dans la langue active (à appeler au rendu, jamais à l'import). */
export function deviceSourceText(source: DeviceSource): DeviceSourceText {
  const t = i18n.t;
  switch (source) {
    case "iosSimulators":
      return {
        title: t("servers:device.simulator"),
        empty: t("servers:device.noSimulator"),
        emptyHelp: null,
        runtimeHelp: false,
      };
    case "watchosSimulators":
    case "tvosSimulators":
    case "visionosSimulators":
      return {
        title: t("servers:device.simulator"),
        empty: t("servers:device.runtimeMissing", { platform: SOURCE_PLATFORM[source].name }),
        emptyHelp: null,
        runtimeHelp: true,
      };
    case "flutterDevices":
      return {
        title: t("servers:device.device"),
        empty: t("servers:device.noDevice"),
        // `flutter devices` ne liste que les appareils démarrés ; le menu relit à chaque ouverture.
        emptyHelp: t("servers:device.flutterHelp"),
        runtimeHelp: false,
      };
    case "androidDevices":
      return {
        title: t("servers:device.androidDevice"),
        empty: t("servers:device.noAndroidDevice"),
        emptyHelp: null,
        runtimeHelp: false,
      };
  }
}

/** Nom accessible du sélecteur : « Simulateur de Demo ». */
export function devicePickerLabel(source: DeviceSource, appName: string): string {
  return i18n.t("servers:device.label", { title: deviceSourceText(source).title, app: appName });
}

/** Infobulle du sélecteur : « Simulateur de Demo », suivi de l'appareil choisi ou de l'aide. */
export function devicePickerTooltip(
  source: DeviceSource,
  appName: string,
  picker: { devices: readonly unknown[]; chosen: { name: string } | null },
): string {
  const label = devicePickerLabel(source, appName);
  if (picker.chosen !== null) {
    return i18n.t("servers:device.chosen", { label, name: picker.chosen.name });
  }
  if (picker.devices.length === 0 && deviceSourceText(source).runtimeHelp) {
    return i18n.t("servers:device.chosen", { label, name: i18n.t("servers:device.runtimeHelp") });
  }
  return label;
}

/**
 * La cible se compile avec Xcode : iOS, watchOS, tvOS, visionOS, macOS, Mac Catalyst, et cible
 * iOS d'Expo ou de React Native.
 */
export function isXcodeTarget(
  target: Pick<AppTarget, "kind"> & Partial<Pick<AppTarget, "deviceSource">>,
): boolean {
  return (
    target.kind === "ios" ||
    target.kind === "watchos" ||
    target.kind === "tvos" ||
    target.kind === "visionos" ||
    target.kind === "macos" ||
    target.kind === "catalyst" ||
    target.deviceSource === "iosSimulators"
  );
}

/** L'app a au moins une cible qui se lance sur un appareil Android. */
export function appUsesAndroid(app: Pick<NativeApp, "targets">): boolean {
  return app.targets.some((t) => t.deviceSource === "androidDevices");
}

/** La cible est une app Flutter (spec apps-flutter.md, décision 0022). */
export function isFlutterTarget(target: Pick<AppTarget, "kind">): boolean {
  return target.kind === "flutter";
}

/** L'app a au moins une cible Flutter. */
export function appUsesFlutter(app: Pick<NativeApp, "targets">): boolean {
  return app.targets.some(isFlutterTarget);
}

/** L'app a au moins une cible Xcode. */
export function appUsesXcode(app: Pick<NativeApp, "targets">): boolean {
  return app.targets.some(isXcodeTarget);
}

/**
 * Exécutions regroupées par app (section « Autres dossiers ») : une entrée par app, dans
 * l'ordre du premier lancement, ses exécutions dans l'ordre de ses cibles.
 */
export function groupRunsByApp(
  runs: Iterable<AppRun>,
): { key: string; app: NativeApp; runs: AppRun[] }[] {
  const groups = new Map<string, { key: string; app: NativeApp; runs: AppRun[] }>();
  for (const run of runs) {
    const key = appIdentity(run.app, run.target);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, app: run.app, runs: [run] });
    else group.runs.push(run);
  }
  for (const group of groups.values()) {
    const order = (run: AppRun) => group.app.targets.findIndex((t) => t.id === run.target.id);
    group.runs.sort((a, b) => order(a) - order(b));
  }
  return [...groups.values()];
}

/** Appareil proposé par un sélecteur (détail en gris : « iOS 27.0 »). */
export type PickerDevice = { id: string; name: string; detail: string };

/** Sélecteur d'appareil d'une cible. `unavailable` : liste en échec (Lancer désactivé). */
export type DevicePicker = {
  devices: PickerDevice[];
  chosen: PickerDevice | null;
  unavailable: boolean;
  /** Première lecture de la liste en cours (Flutter : `flutter devices` prend quelques secondes). */
  loading?: boolean;
};

/** Appareils Flutter de l'app de la cible (déjà filtrés par plateforme en Rust). */
export type FlutterDeviceSource = {
  devices: readonly FlutterDevice[];
  /** Dernier choix pour le dossier de l'app (`loadFlutterDeviceChoice`). */
  savedId: string | null;
  /** Flutter introuvable ou lecture en échec. */
  unavailable: boolean;
  loading: boolean;
};

/** Simulateurs Apple : sources dont les appareils viennent de `simctl`. */
type SimulatorDeviceSource = Exclude<DeviceSource, "androidDevices" | "flutterDevices">;

/** Plateforme des simulateurs d'une source (`Simulator.platform`) et son nom dans le détail. */
export const SOURCE_PLATFORM = {
  iosSimulators: { platform: "ios", name: "iOS" },
  watchosSimulators: { platform: "watchos", name: "watchOS" },
  tvosSimulators: { platform: "tvos", name: "tvOS" },
  visionosSimulators: { platform: "visionos", name: "visionOS" },
} as const satisfies Record<SimulatorDeviceSource, { platform: SimPlatform; name: string }>;

/** Simulateurs d'une source, déjà filtrés par plateforme. */
export type SimulatorSource = {
  devices: readonly Pick<Simulator, "id" | "name" | "osVersion">[];
  /** Dernier choix pour le projet de la cible (`loadSimulatorChoice`). */
  savedId: string | null;
  unavailable: boolean;
};

/** Appareils Android connus du provider. */
export type AndroidSource = {
  devices: readonly AndroidDevice[];
  /** Dernier choix pour le projet de la cible (`loadDeviceChoice`). */
  savedId: string | null;
  /** SDK introuvable ou `adb` en échec. */
  unavailable: boolean;
};

const NO_ANDROID: AndroidSource = {
  devices: [],
  savedId: null,
  unavailable: false,
};

/** Ce que le provider sait de chaque source d'appareils (décision 0020). Une source absente
 * n'a aucun appareil. */
export type DeviceSources = { iosSimulators: SimulatorSource } & Partial<
  Record<Exclude<SimulatorDeviceSource, "iosSimulators">, SimulatorSource>
> & {
    /** Absente : pas d'app Flutter, la source se comporte comme une liste en échec. */
    flutterDevices?: FlutterDeviceSource;
    /** Absent : aucun appareil Android connu (liste pas encore lue). */
    androidDevices?: AndroidSource;
  };

const NO_DEVICES: SimulatorSource = { devices: [], savedId: null, unavailable: false };

/** Sélecteur d'une cible : `null` sans source d'appareils ; sinon la liste et l'appareil retenu
 * (dernier choix encore présent, sinon le premier). */
export function devicesFor(
  target: Pick<AppTarget, "deviceSource">,
  sources: DeviceSources,
): DevicePicker | null {
  if (target.deviceSource === null) return null;
  if (target.deviceSource === "flutterDevices") {
    const source = sources.flutterDevices;
    const devices = source?.devices ?? [];
    const toPicker = (d: FlutterDevice): PickerDevice => ({
      id: d.id,
      name: d.name,
      detail: d.os === "" ? d.platform : d.os,
    });
    const chosen = devices.find((d) => d.id === source?.savedId) ?? devices[0] ?? null;
    return {
      devices: devices.map(toPicker),
      chosen: chosen === null ? null : toPicker(chosen),
      unavailable: source?.unavailable ?? true,
      loading: source?.loading ?? false,
    };
  }
  if (target.deviceSource === "androidDevices") {
    const { devices, savedId, unavailable } = sources.androidDevices ?? NO_ANDROID;
    const toPicker = (d: AndroidDevice): PickerDevice => ({
      id: d.id,
      name: d.name,
      detail: i18n.t(d.emulator ? "servers:device.emulator" : "servers:device.plugged"),
    });
    const chosen = devices.find((d) => d.id === savedId) ?? devices[0];
    return {
      devices: devices.map(toPicker),
      chosen: chosen === undefined ? null : toPicker(chosen),
      unavailable,
    };
  }
  const { devices, savedId, unavailable } = sources[target.deviceSource] ?? NO_DEVICES;
  const name = SOURCE_PLATFORM[target.deviceSource].name;
  const toPicker = (s: SimulatorSource["devices"][number]): PickerDevice => ({
    id: s.id,
    name: s.name,
    detail: `${name} ${s.osVersion}`,
  });
  const chosen = defaultSimulator(devices, savedId);
  return {
    devices: devices.map(toPicker),
    chosen: chosen === null ? null : toPicker(chosen),
    unavailable,
  };
}

export type AppGesture = "launch" | "stop" | "terminal";

/** Libellé d'un état d'app dans la langue active (à appeler au rendu). */
export function appStatusLabel(status: AppStatus): string {
  return i18n.t(`servers:appStatus.${status}`);
}

/**
 * Simulateur par défaut d'un projet : le dernier choisi s'il est encore dans la liste, sinon le
 * premier ; `null` sans simulateur.
 */
export function defaultSimulator<T extends { id: string }>(
  simulators: readonly T[],
  savedId: string | null,
): T | null {
  return simulators.find((s) => s.id === savedId) ?? simulators[0] ?? null;
}

/**
 * Clé du localStorage du simulateur choisi pour un projet Xcode (chemin absolu). iOS garde la
 * clé d'origine ; les autres plateformes ont chacune la leur (`explorateur.simulator:watchos:…`).
 */
export function simulatorStorageKey(project: string, platform: SimPlatform = "ios"): string {
  return platform === "ios"
    ? `explorateur.simulator:${project}`
    : `explorateur.simulator:${platform}:${project}`;
}

/** Clé du localStorage de l'appareil choisi pour un projet, selon la source (décision 0020) :
 * `explorateur.simulator:[<plateforme>:]<projet>` ou `explorateur.androidDevice:<projet>`. */
export function deviceStorageKey(source: DeviceSource, project: string): string {
  if (source === "flutterDevices") return flutterDeviceStorageKey(project);
  return source === "androidDevices"
    ? `explorateur.androidDevice:${project}`
    : simulatorStorageKey(project, SOURCE_PLATFORM[source].platform);
}

/** Dernier appareil choisi pour `project` dans `source` ; stockage refusé : aucun. */
export function loadDeviceChoice(
  storage: Pick<Storage, "getItem">,
  source: DeviceSource,
  project: string,
): string | null {
  try {
    return storage.getItem(deviceStorageKey(source, project));
  } catch {
    return null;
  }
}

/** Enregistre le choix ; un échec (stockage refusé) est ignoré. */
export function saveDeviceChoice(
  storage: Pick<Storage, "setItem">,
  source: DeviceSource,
  project: string,
  id: string,
): void {
  try {
    storage.setItem(deviceStorageKey(source, project), id);
  } catch {
    // Non enregistré.
  }
}

/** Dernier simulateur choisi pour `project` ; stockage absent ou refusé : aucun. */
export function loadSimulatorChoice(
  storage: Pick<Storage, "getItem">,
  project: string,
  platform: SimPlatform = "ios",
): string | null {
  try {
    return storage.getItem(simulatorStorageKey(project, platform));
  } catch {
    return null;
  }
}

/** Enregistre le choix ; un échec (stockage refusé) est ignoré, le choix vaut pour la session. */
export function saveSimulatorChoice(
  storage: Pick<Storage, "setItem">,
  project: string,
  id: string,
  platform: SimPlatform = "ios",
): void {
  try {
    storage.setItem(simulatorStorageKey(project, platform), id);
  } catch {
    // Non enregistré.
  }
}

/** Clé du localStorage de l'appareil Flutter choisi pour une app (son dossier, absolu). */
export function flutterDeviceStorageKey(dir: string): string {
  return `explorateur.flutter-device:${dir}`;
}

/** Dernier appareil Flutter choisi pour `dir` ; stockage absent ou refusé : aucun. */
export function loadFlutterDeviceChoice(
  storage: Pick<Storage, "getItem">,
  dir: string,
): string | null {
  try {
    return storage.getItem(flutterDeviceStorageKey(dir));
  } catch {
    return null;
  }
}

/** Enregistre le choix ; un échec (stockage refusé) est ignoré, le choix vaut pour la session. */
export function saveFlutterDeviceChoice(
  storage: Pick<Storage, "setItem">,
  dir: string,
  id: string,
): void {
  try {
    storage.setItem(flutterDeviceStorageKey(dir), id);
  } catch {
    // Non enregistré.
  }
}

/** Compteur du bouton : serveurs En ligne et cibles En cours (une exécution par cible). */
export function activeCount(
  serverRuns: ReadonlyMap<string, Pick<ServerRun, "online">>,
  appRuns: ReadonlyMap<string, unknown>,
): number {
  return [...serverRuns.values()].filter((r) => r.online).length + appRuns.size;
}
