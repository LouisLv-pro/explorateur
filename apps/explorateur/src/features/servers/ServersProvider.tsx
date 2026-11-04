// Serveurs locaux (spec serveurs-locaux.md, décision 0008) et apps natives (spec
// apps-natives.md, décision 0009) : détection du dossier racine, et suivi de ce qui est lancé
// dans une page du terminal. Au-dessus du dossier racine, sous le terminal : changer de dossier
// ne perd aucun serveur ni aucune app en cours.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  events,
  type AndroidDevice,
  type AppTarget,
  type DeviceSource,
  type NativeApp,
  type ServerList,
  type Simulator,
} from "@/bindings";
import { useRunningTerminals } from "@/features/terminal/api";
import { useTerminalActions, useTerminalView } from "@/features/terminal/context";
import { subscribeOutput } from "@/features/terminal/output";
import { useWorkspace } from "@/features/workspace/context";
import i18n from "@/i18n";
import {
  detectAppsKey,
  detectServersKey,
  flutterDevicesKey,
  getAppCommand,
  getFlutterCommand,
  isPortOpen,
  useDetectApps,
  useAndroidDevices,
  useDetectServers,
  useFlutterDevices,
  useSimulators,
} from "./api";
import {
  appUsesAndroid,
  appUsesFlutter,
  appUsesXcode,
  deviceStorageKey,
  devicesFor,
  isFlutterTarget,
  loadDeviceChoice,
  loadFlutterDeviceChoice,
  saveDeviceChoice,
  saveFlutterDeviceChoice,
  SOURCE_PLATFORM,
  targetKey,
  targetLabel,
  type AppRun,
} from "./apps";
import { ServersContext, type ServersState } from "./context";
import { START_GRACE_MS, serverKey, touchesServerFiles, type ServerRun } from "./model";
import { findServerUrl, portOfUrl } from "./url";

/** Sondage du port en Démarrage (spec : toutes les 500 ms). */
const PROBE_MS = 500;
/** Sortie gardée pour y chercher l'URL (une URL peut arriver coupée en deux envois). */
const OUTPUT_TAIL = 4096;

const NO_SERVERS: ServerList = { servers: [], launchError: null };
const NO_APPS: NativeApp[] = [];
const NO_SIMULATORS: Simulator[] = [];
/** Source iOS vide, pour les cibles dont la source est une autre plateforme. */
const NO_SOURCE = { devices: NO_SIMULATORS, savedId: null, unavailable: false };
const NO_ANDROID_DEVICES: AndroidDevice[] = [];

type RunPatch = Partial<Pick<ServerRun, "url" | "online" | "seenRunning" | "openOnOnline">>;
type AppPatch = Partial<Pick<AppRun, "seenRunning">>;

/** Ce que le suivi d'une page de terminal lit d'un serveur ou d'une app lancés. */
type TrackedRun = { key: string; pageId: number; seenRunning: boolean; startedAt: number };

// L'accès à `localStorage` lui-même peut lever (stockage refusé).
function readChoice(source: DeviceSource, project: string): string | null {
  try {
    return loadDeviceChoice(localStorage, source, project);
  } catch {
    return null;
  }
}

function writeChoice(source: DeviceSource, project: string, id: string) {
  try {
    saveDeviceChoice(localStorage, source, project, id);
  } catch {
    // Non enregistré : le choix vaut pour la session.
  }
}

/** Clé de `choices` pour l'appareil Flutter d'une app (ne peut pas être un chemin de projet). */
const flutterChoiceKey = (dir: string) => `flutter:${dir}`;

function readFlutterChoice(dir: string): string | null {
  try {
    return loadFlutterDeviceChoice(localStorage, dir);
  } catch {
    return null;
  }
}

function writeFlutterChoice(dir: string, id: string) {
  try {
    saveFlutterDeviceChoice(localStorage, dir, id);
  } catch {
    // Non enregistré : le choix vaut pour la session.
  }
}

export function ServersProvider({ children }: { children: ReactNode }) {
  const { root, openServerTab, showError } = useWorkspace();
  const terminal = useTerminalActions();
  const queryClient = useQueryClient();
  const rootPath = root?.path ?? null;
  const detection = useDetectServers(rootPath);
  const appDetection = useDetectApps(rootPath);
  const apps = appDetection.data ?? NO_APPS;
  const hasXcode = apps.some(appUsesXcode);
  const simulatorQuery = useSimulators(hasXcode);
  // `flutter devices` est lent : lu à la première ouverture du menu, puis à chaque ouverture
  // (cache de 15 s côté Rust), jamais au démarrage.
  const [flutterWanted, setFlutterWanted] = useState(false);
  const flutterDirs = useMemo(() => apps.filter(appUsesFlutter).map((a) => a.dir), [apps]);
  const flutterReads = useFlutterDevices(flutterDirs, flutterWanted);
  const hasAndroid = apps.some(appUsesAndroid);
  const androidQuery = useAndroidDevices(hasAndroid);
  const [runs, setRuns] = useState<ReadonlyMap<string, ServerRun>>(new Map());
  const [appRuns, setAppRuns] = useState<ReadonlyMap<string, AppRun>>(new Map());
  /** Appareil choisi par source et projet pendant la session (clé `deviceStorageKey` ; le
   * `localStorage` le garde aussi). */
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(new Map());
  const runsRef = useRef(runs);
  const appRunsRef = useRef(appRuns);
  useLayoutEffect(() => {
    runsRef.current = runs;
    appRunsRef.current = appRuns;
  });
  /** Dernière page de terminal de chaque serveur ou app (clé), réutilisée à la relance. */
  const lastPages = useRef(new Map<string, number>());
  /** Lancements qui attendent la réponse de `rerunCommand` ou de Rust (double clic). */
  const launching = useRef(new Set<string>());

  const patch = useCallback((key: string, change: RunPatch | null) => {
    setRuns((current) => {
      const run = current.get(key);
      if (run === undefined) return current;
      const next = new Map(current);
      if (change === null) next.delete(key);
      else {
        const goesOnline = change.online === true && !run.online;
        next.set(key, { ...run, ...change, onlineSeq: run.onlineSeq + (goesOnline ? 1 : 0) });
      }
      return next;
    });
  }, []);

  const patchApp = useCallback((key: string, change: AppPatch | null) => {
    setAppRuns((current) => {
      const run = current.get(key);
      if (run === undefined) return current;
      const next = new Map(current);
      if (change === null) next.delete(key);
      else next.set(key, { ...run, ...change });
      return next;
    });
  }, []);

  /** Tape `command` dans la dernière page de `key` si elle est revenue au prompt, sinon dans
   * une nouvelle page titrée `label`. */
  const startInTerminal = useCallback(
    async (key: string, dir: string, label: string, command: string): Promise<number> => {
      const previous = lastPages.current.get(key);
      const reused = previous !== undefined && (await terminal.rerunCommand(previous, command));
      const pageId =
        reused && previous !== undefined ? previous : terminal.runCommand(dir, { label, command });
      lastPages.current.set(key, pageId);
      return pageId;
    },
    [terminal],
  );

  // Changement d'un package.json, d'un fichier de verrouillage, de launch.json ou d'un projet
  // Xcode : relecture des serveurs et des apps.
  useEffect(() => {
    if (rootPath === null) return;
    const unlisten = events.diskChanged.listen((event) => {
      if (touchesServerFiles(event.payload)) {
        void queryClient.invalidateQueries({ queryKey: detectServersKey(rootPath) });
        void queryClient.invalidateQueries({ queryKey: detectAppsKey(rootPath) });
      }
    });
    return () => void unlisten.then((off) => off());
  }, [queryClient, rootPath]);

  const detected = detection.data ?? NO_SERVERS;
  const { refetch } = detection;
  const { refetch: refetchApps } = appDetection;
  const { refetch: refetchSimulators } = simulatorQuery;
  const simulators = simulatorQuery.data ?? NO_SIMULATORS;
  const xcodeMissing = simulatorQuery.isError;
  const flutterMissing = flutterReads.some((r) => r.data !== null && !r.data.flutterFound);
  const flutterError = flutterReads.find((r) => r.error !== null)?.error ?? null;
  const { refetch: refetchAndroid } = androidQuery;
  const androidDevices = androidQuery.data ?? NO_ANDROID_DEVICES;
  const androidSdkMissing = androidQuery.isError;

  const value = useMemo<ServersState>(() => {
    const pickerFor = (app: NativeApp, target: AppTarget) => {
      const source = target.deviceSource;
      if (source === null) return null;
      if (source === "flutterDevices") {
        const read = flutterReads[flutterDirs.indexOf(app.dir)];
        return devicesFor(target, {
          iosSimulators: NO_SOURCE,
          flutterDevices: {
            devices: read?.data?.devices ?? [],
            savedId: choices.get(flutterChoiceKey(app.dir)) ?? readFlutterChoice(app.dir),
            unavailable: read === undefined || read.error !== null || flutterMissing,
            loading: read?.loading ?? false,
          },
        });
      }
      // Appareil gardé par projet et par source (partagé par ses schémas ou ses modules).
      const project = target.project ?? app.dir;
      const savedId = choices.get(deviceStorageKey(source, project)) ?? readChoice(source, project);
      if (source === "androidDevices") {
        return devicesFor(target, {
          iosSimulators: NO_SOURCE,
          androidDevices: {
            devices: androidDevices,
            savedId,
            unavailable: androidSdkMissing,
          },
        });
      }
      const { platform } = SOURCE_PLATFORM[source];
      return devicesFor(target, {
        iosSimulators: NO_SOURCE,
        [source]: {
          devices: simulators.filter((s) => s.platform === platform),
          savedId,
          unavailable: xcodeMissing,
        },
      });
    };
    return {
      detected,
      runs,
      serverOf: (key) =>
        runs.get(key)?.server ?? detected.servers.find((s) => serverKey(s) === key),
      refresh: () => {
        void refetch();
        void refetchApps();
        if (hasXcode) void refetchSimulators();
        setFlutterWanted(true);
        void queryClient.invalidateQueries({ queryKey: flutterDevicesKey });
        if (hasAndroid) void refetchAndroid();
      },
      launch: (server) => {
        const key = serverKey(server);
        if (server.command === null || rootPath === null) return;
        const existing = runsRef.current.get(key);
        if (existing !== undefined) {
          terminal.reveal(existing.pageId);
          return;
        }
        if (launching.current.has(key)) return;
        launching.current.add(key);
        void startInTerminal(key, server.dir, server.name, server.command).then((pageId) => {
          launching.current.delete(key);
          const run: ServerRun = {
            key,
            server,
            rootPath,
            pageId,
            url: server.url,
            online: false,
            seenRunning: false,
            startedAt: Date.now(),
            onlineSeq: 0,
            openOnOnline: true,
          };
          setRuns((current) => new Map(current).set(key, run));
        });
      },
      stop: (key) => {
        const run = runsRef.current.get(key);
        if (run !== undefined) terminal.write(run.pageId, "\x03");
      },
      showTerminal: (key) => {
        const run = runsRef.current.get(key);
        if (run !== undefined) terminal.reveal(run.pageId);
      },
      preview: (server) => openServerTab(serverKey(server), server.name),

      apps,
      appRuns,
      xcodeMissing,
      flutterMissing,
      flutterError,
      androidSdkMissing,
      devicesFor: pickerFor,
      chooseDevice: (app, target, id) => {
        if (target.deviceSource === "flutterDevices") {
          // Choix gardé par app (son dossier), pas par projet.
          writeFlutterChoice(app.dir, id);
          setChoices((current) => new Map(current).set(flutterChoiceKey(app.dir), id));
          return;
        }
        const source = target.deviceSource;
        if (source === null) return;
        const project = target.project ?? app.dir;
        writeChoice(source, project, id);
        setChoices((current) => new Map(current).set(deviceStorageKey(source, project), id));
      },
      launchApp: (app, target) => {
        const key = targetKey(app, target);
        if (rootPath === null) return;
        const existing = appRunsRef.current.get(key);
        if (existing !== undefined) {
          terminal.reveal(existing.pageId);
          return;
        }
        if (launching.current.has(key)) return;
        launching.current.add(key);
        const deviceId = pickerFor(app, target)?.chosen?.id ?? null;
        const command =
          target.command ??
          (isFlutterTarget(target)
            ? // Flutter est cherché dans le dossier de l'app (FVM) : commande dédiée.
              getFlutterCommand(app.dir, deviceId ?? "")
            : getAppCommand(target, deviceId));
        void Promise.resolve(command)
          .then((text) => startInTerminal(key, app.dir, targetLabel(app, target), text))
          .then(
            (pageId) => {
              const run: AppRun = {
                key,
                app,
                target,
                rootPath,
                pageId,
                seenRunning: false,
                startedAt: Date.now(),
              };
              setAppRuns((current) => new Map(current).set(key, run));
            },
            (error: unknown) =>
              showError(
                i18n.t("servers:error.launchFailed", {
                  detail: error instanceof Error ? error.message : String(error),
                }),
              ),
          )
          .finally(() => launching.current.delete(key));
      },
      stopApp: (key) => {
        const run = appRunsRef.current.get(key);
        if (run !== undefined) terminal.write(run.pageId, "\x03");
      },
      showAppTerminal: (key) => {
        const run = appRunsRef.current.get(key);
        if (run !== undefined) terminal.reveal(run.pageId);
      },
    };
  }, [
    detected,
    runs,
    refetch,
    refetchApps,
    refetchSimulators,
    hasXcode,
    rootPath,
    terminal,
    openServerTab,
    showError,
    startInTerminal,
    apps,
    appRuns,
    simulators,
    xcodeMissing,
    refetchAndroid,
    hasAndroid,
    androidDevices,
    androidSdkMissing,
    choices,
    queryClient,
    flutterDirs,
    flutterReads,
    flutterMissing,
    flutterError,
  ]);

  return (
    <ServersContext value={value}>
      {children}
      <RunsWatcher runs={runs} patch={patch} />
      <RunsWatcher runs={appRuns} patch={patchApp} />
      {[...runs.values()].map((run) => (
        <RunMonitor key={run.key} run={run} patch={patch} onOnline={openServerTab} />
      ))}
    </ServersContext>
  );
}

/** Suit des pages lancées (serveurs ou apps) : processus en cours et page encore ouverte. */
function RunsWatcher<T extends TrackedRun>({
  runs,
  patch,
}: {
  runs: ReadonlyMap<string, T>;
  patch: (key: string, change: { seenRunning: true } | null) => void;
}) {
  const { pages } = useTerminalView();
  const running = useRunningTerminals(runs.size > 0);

  // Page fermée, commande terminée (la page revient au prompt) : retour à Arrêté.
  useEffect(() => {
    for (const run of runs.values()) {
      const pageOpen = pages.some((p) => p.id === run.pageId);
      const isRunning = running.has(run.pageId);
      if (!pageOpen) patch(run.key, null);
      else if (isRunning && !run.seenRunning) patch(run.key, { seenRunning: true });
      else if (!isRunning && run.seenRunning) patch(run.key, null);
    }
  }, [runs, pages, running, patch]);

  // Sans processus vu après le délai de grâce, la commande a échoué tout de suite.
  const hasUnseen = [...runs.values()].some((r) => !r.seenRunning);
  const onGrace = useEffectEvent(() => {
    const now = Date.now();
    for (const run of runs.values()) {
      if (!run.seenRunning && now - run.startedAt > START_GRACE_MS && !running.has(run.pageId)) {
        patch(run.key, null);
      }
    }
  });
  useEffect(() => {
    if (!hasUnseen) return;
    const timer = setInterval(() => onGrace(), 1000);
    return () => clearInterval(timer);
  }, [hasUnseen]);

  return null;
}

/** Un serveur lancé : URL lue dans la sortie, puis port sondé jusqu'au passage En ligne. */
function RunMonitor({
  run,
  patch,
  onOnline,
}: {
  run: ServerRun;
  patch: (key: string, change: RunPatch | null) => void;
  onOnline: (key: string, name: string) => void;
}) {
  const { key, pageId, url, online } = run;

  useEffect(() => {
    if (url !== null) return;
    let tail = "";
    return subscribeOutput(pageId, (text) => {
      tail = (tail + text).slice(-OUTPUT_TAIL);
      const found = findServerUrl(tail);
      if (found !== null) patch(key, { url: found });
    });
  }, [key, pageId, url, patch]);

  const goOnline = useEffectEvent(() => {
    const open = run.openOnOnline;
    patch(key, { online: true, openOnOnline: false });
    if (open) onOnline(key, run.server.name);
  });
  useEffect(() => {
    if (url === null || online) return;
    const port = portOfUrl(url);
    if (port === null) return;
    let live = true;
    const probe = () => {
      void isPortOpen(port).then((open) => {
        if (live && open) goOnline();
      });
    };
    probe();
    const timer = setInterval(probe, PROBE_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, online]);

  return null;
}
