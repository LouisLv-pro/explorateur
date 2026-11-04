import { createContext, useContext } from "react";
import type { AppTarget, NativeApp, Server, ServerList } from "@/bindings";
import type { AppRun, DevicePicker } from "./apps";
import type { ServerRun } from "./model";

/** Serveurs locaux et apps natives : détectés (dossier racine), lancés (tous dossiers), et
 * leurs gestes. */
export type ServersState = {
  /** Détection du dossier racine. */
  detected: ServerList;
  /** Serveurs lancés depuis l'app, par clé (`serverKey`). */
  runs: ReadonlyMap<string, ServerRun>;
  /** Serveur d'une clé : lancé, sinon détecté ; `undefined` s'il a disparu. */
  serverOf: (key: string) => Server | undefined;
  /** Relit la détection (ouverture du menu). */
  refresh: () => void;
  launch: (server: Server) => void;
  stop: (key: string) => void;
  showTerminal: (key: string) => void;
  /** Ouvre (ou active) l'onglet d'aperçu du serveur. */
  preview: (server: Server) => void;

  /** Apps natives du dossier racine (spec apps-natives.md, décision 0020). */
  apps: readonly NativeApp[];
  /** Cibles lancées depuis l'app, par clé (`targetKey`), tous dossiers. */
  appRuns: ReadonlyMap<string, AppRun>;
  /** Xcode absent ou `simctl` en échec : Lancer désactivé pour les cibles Xcode. */
  xcodeMissing: boolean;
  /** Une app Flutter est listée mais Flutter est introuvable : Lancer désactivé pour elles. */
  flutterMissing: boolean;
  /** Lecture des appareils Flutter en échec (message de Rust) ; `null` sinon. */
  flutterError: string | null;
  /** SDK Android introuvable ou `adb` en échec : Lancer désactivé pour les cibles Android. */
  androidSdkMissing: boolean;
  /** Sélecteur d'appareil d'une cible (`null` sans source d'appareils). */
  devicesFor: (app: NativeApp, target: AppTarget) => DevicePicker | null;
  /** Garde l'appareil choisi (`localStorage`), pour le prochain lancement. */
  chooseDevice: (app: NativeApp, target: AppTarget, id: string) => void;
  launchApp: (app: NativeApp, target: AppTarget) => void;
  stopApp: (key: string) => void;
  showAppTerminal: (key: string) => void;
};

export const ServersContext = createContext<ServersState | null>(null);

export function useServers(): ServersState {
  const value = useContext(ServersContext);
  if (!value) throw new Error("useServers hors de <ServersProvider>");
  return value;
}
