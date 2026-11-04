// Serveurs locaux (spec serveurs-locaux.md, glossaire : Server, ServerStatus) : état d'un
// serveur et gestes proposés. Fonctions pures.
import type { DiskChange, Server } from "@/bindings";
import i18n from "@/i18n";
import { portOfUrl } from "./url";

/** `stopped` (Arrêté), `starting` (Démarrage), `online` (En ligne). */
export type ServerStatus = "stopped" | "starting" | "online";

/** Serveur lancé depuis l'app : sa page de terminal et ce qu'on en sait. */
export type ServerRun = {
  key: string;
  server: Server;
  /** Dossier racine ouvert au lancement (section « Autres dossiers » après un changement). */
  rootPath: string;
  /** Page de terminal qui exécute la commande. */
  pageId: number;
  /** URL connue (`launch.json` ou lue dans la sortie), `null` avant. */
  url: string | null;
  /** Le port de l'URL a accepté une connexion. */
  online: boolean;
  /** La page a été vue avec un processus en cours : sa fin ramène le serveur à Arrêté. */
  seenRunning: boolean;
  /** `Date.now()` au lancement. */
  startedAt: number;
  /** Incrémenté à chaque passage En ligne : l'iframe de l'aperçu se recharge. */
  onlineSeq: number;
  /** Ouvrir l'aperçu au premier passage En ligne (vrai après Lancer). */
  openOnOnline: boolean;
};

/** Sans processus vu après ce délai, la commande a échoué tout de suite : retour à Arrêté. */
export const START_GRACE_MS = 8000;

/** Clé stable d'un serveur : dossier de lancement et nom. */
export function serverKey(server: Pick<Server, "dir" | "name">): string {
  return `${server.dir}::${server.name}`;
}

export function statusOf(run: ServerRun | undefined): ServerStatus {
  if (run === undefined) return "stopped";
  return run.online ? "online" : "starting";
}

/** État affiché d'un serveur ; `null` pour un serveur lancé ailleurs (aucun état suivi). */
export function serverStatus(server: Server, run: ServerRun | undefined): ServerStatus | null {
  return server.command === null ? null : statusOf(run);
}

export type ServerGesture = "launch" | "preview" | "stop" | "terminal";

/**
 * Gestes d'une ligne du menu, dans l'ordre ; le premier est celui de `↵`. Un serveur lancé
 * ailleurs (`launch.json` à `url` seule) n'a que l'Aperçu.
 */
export function serverGestures(server: Server, status: ServerStatus): ServerGesture[] {
  if (server.command === null) return server.url === null ? [] : ["preview"];
  switch (status) {
    case "stopped":
      return ["launch"];
    case "starting":
      return ["terminal", "stop"];
    case "online":
      return ["preview", "terminal", "stop"];
  }
}

/** Libellé d'un geste dans la langue active (à appeler au rendu, jamais à l'import). */
export function gestureLabel(gesture: ServerGesture): string {
  return i18n.t(`servers:gesture.${gesture}`);
}

/** Libellé d'un état ; `null` : serveur lancé ailleurs. */
export function statusLabel(status: ServerStatus | null): string {
  return i18n.t(status === null ? "servers:status.elsewhere" : `servers:status.${status}`);
}

const WATCHED_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  // Apps natives (projets Xcode).
  "project.pbxproj",
  "contents.xcworkspacedata",
  // Apps lancées par une commande (apps-commandes.md) : binaires Cargo et exécutables Swift.
  "Cargo.toml",
  "Package.swift",
  // Apps Android (projets Gradle).
  "settings.gradle",
  "settings.gradle.kts",
  "build.gradle",
  "build.gradle.kts",
  "libs.versions.toml",
]);

/** Vrai si un changement disque touche un fichier lu par la détection (serveurs et apps). */
export function touchesServerFiles(change: DiskChange): boolean {
  return change.files.some((path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return (
      WATCHED_NAMES.has(name) || name.endsWith(".xcscheme") || path.endsWith("/.claude/launch.json")
    );
  });
}

/** Port affiché d'un serveur : celui de l'URL connue, sinon le port attendu. */
export function shownPort(server: Server, url: string | null): number | null {
  return (url === null ? null : portOfUrl(url)) ?? server.port;
}

/** Sous-titre d'une ligne : dossier relatif et commande du script, tronquée. */
export function serverSubtitle(server: Server, max = 48): string {
  const command = server.script ?? server.command ?? server.url ?? "";
  const short = command.length > max ? `${command.slice(0, max - 1)}…` : command;
  return server.relativeDir === "." ? short : `${server.relativeDir} · ${short}`;
}
