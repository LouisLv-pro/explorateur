// Appels Rust des serveurs locaux (décision 0008) : détection et test de connexion.
import { useQueries, useQuery } from "@tanstack/react-query";
import { commands, type AppTarget, type NativeApp, type ServerList } from "@/bindings";
import { appErrorText, isAppError } from "@/lib/ipc";

export const detectServersKey = (root: string) => ["detect_servers", root] as const;

const EMPTY: ServerList = { servers: [], launchError: null };

/** Serveurs du dossier racine ; relus à l'ouverture du menu et sur `DiskChanged` (provider). */
export function useDetectServers(root: string | null) {
  return useQuery({
    queryKey: detectServersKey(root ?? ""),
    queryFn: async () => {
      const result = await commands.detectServers(root ?? "");
      if (result.status === "error") throw result.error;
      return result.data;
    },
    enabled: root !== null,
    placeholderData: EMPTY,
  });
}

export const detectAppsKey = (root: string) => ["detect_apps", root] as const;

const NO_APPS: NativeApp[] = [];

/** Apps natives du dossier racine ; relues avec les serveurs (spec apps-natives.md). */
export function useDetectApps(root: string | null) {
  return useQuery({
    queryKey: detectAppsKey(root ?? ""),
    queryFn: async () => {
      const result = await commands.detectApps(root ?? "");
      if (result.status === "error") throw result.error;
      return result.data;
    },
    enabled: root !== null,
    placeholderData: NO_APPS,
  });
}

/** Simulateurs iOS ; une erreur (Xcode absent, `simctl` en échec) donne « Xcode introuvable ». */
export function useSimulators(enabled: boolean) {
  return useQuery({
    queryKey: ["list_simulators"],
    queryFn: async () => {
      const result = await commands.listSimulators();
      if (result.status === "error") throw result.error;
      return result.data;
    },
    enabled,
    retry: false,
  });
}

export const flutterDevicesKey = ["list_flutter_devices"] as const;

/** Appareils Flutter d'une app : lus par Rust (cache de 15 s, décision 0022) ; une erreur est
 * gardée telle quelle pour le message du menu. `enabled` : après la première ouverture du menu. */
export function useFlutterDevices(dirs: readonly string[], enabled: boolean) {
  return useQueries({
    queries: dirs.map((dir) => ({
      queryKey: [...flutterDevicesKey, dir],
      queryFn: async () => {
        const result = await commands.listFlutterDevices(dir, false);
        if (result.status === "error") throw result.error;
        return result.data;
      },
      enabled,
      retry: false,
    })),
    combine: (results) =>
      results.map((r) => ({
        data: r.data ?? null,
        error:
          r.error === null ? null : isAppError(r.error) ? appErrorText(r.error) : String(r.error),
        // Désactivée (menu jamais ouvert) : pas de lecture en cours.
        loading: r.isFetching && r.data === undefined,
      })),
  });
}

/** Commande de lancement d'une app Flutter sur l'appareil choisi (Flutter cherché en Rust). */
export async function getFlutterCommand(dir: string, deviceId: string): Promise<string> {
  const result = await commands.getFlutterCommand(dir, deviceId);
  if (result.status === "error") throw new Error(appErrorText(result.error));
  return result.data;
}

/** Émulateurs et appareils Android ; une erreur (SDK introuvable, `adb` en échec) donne « SDK
 * Android introuvable » (spec apps-android.md). */
export function useAndroidDevices(enabled: boolean) {
  return useQuery({
    queryKey: ["list_android_devices"],
    queryFn: async () => {
      const result = await commands.listAndroidDevices();
      if (result.status === "error") throw result.error;
      return result.data;
    },
    enabled,
    retry: false,
  });
}

/** Commande de lancement d'une cible sans commande fixe (construite en Rust selon son genre). */
export async function getAppCommand(target: AppTarget, deviceId: string | null): Promise<string> {
  const result = await commands.getAppCommand(target, deviceId);
  if (result.status === "error") throw new Error(appErrorText(result.error));
  return result.data;
}

/** Le port accepte-t-il une connexion ? Une erreur compte comme non. */
export async function isPortOpen(port: number): Promise<boolean> {
  const result = await commands.isPortOpen(port);
  return result.status === "ok" && result.data;
}
