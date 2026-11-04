// Ouverture depuis le Finder, un lien ou la commande `explorateur` (docs/specs/
// ouvrir-depuis-finder.md et ouvrir-depuis-terminal.md) : que faire d'une cible rendue par
// `take_opened_paths`. Fonctions pures, sans React ni Tauri.
import type { Entry, OpenTarget } from "@/bindings";
import { openTab, type TabsState } from "@/features/tabs/tabs";
import i18n from "@/i18n";

/** Ligne à montrer dans le dernier fichier, absente si la cible n'en donne pas. */
type WithLine = { line?: number };

/** Décision pour une cible reçue. */
export type OpenPlan =
  /** Rien reçu d'ouvrable. */
  | { kind: "none" }
  /** Même dossier racine : les fichiers s'ouvrent, sans confirmation. */
  | ({ kind: "sameRoot"; files: Entry[] } & WithLine)
  /** Autre dossier racine (Finder) : même chemin que ⌘O (confirmation s'il reste des modifications). */
  | ({ kind: "otherRoot"; root: string; files: Entry[] } & WithLine)
  /**
   * Autre dossier racine demandé par un lien ou la CLI : « Ouvrir le dossier … ? » d'abord
   * (décision 0013), puis comme `otherRoot`.
   */
  | ({ kind: "confirmRoot"; root: string; files: Entry[] } & WithLine);

/** Plan d'un changement de dossier racine (`otherRoot` ou `confirmRoot`). */
export type RootPlan = Extract<OpenPlan, { root: string }>;

/** Chemin sans `/` final, pour comparer deux dossiers. */
const trimmed = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** `currentRoot` : chemin du dossier racine affiché, `null` s'il n'y en a pas. */
export function planOpen(target: OpenTarget | null, currentRoot: string | null): OpenPlan {
  if (target === null) return { kind: "none" };
  // Seulement si présente : les cibles sans ligne restent égales à `{ kind, files }`.
  const line = typeof target.line === "number" ? { line: target.line } : {};
  if (currentRoot !== null && trimmed(currentRoot) === trimmed(target.root)) {
    return { kind: "sameRoot", files: target.files, ...line };
  }
  const kind = target.link === true ? "confirmRoot" : "otherRoot";
  return { kind, root: target.root, files: target.files, ...line };
}

/**
 * Ouvre `files` en onglets épinglés, dans l'ordre : le dernier devient le fichier courant, à la
 * ligne `line` s'il y en a une. Un fichier déjà ouvert garde son onglet (il devient courant,
 * s'épingle, va à la ligne) sans second onglet.
 */
export function openEntries(state: TabsState, files: Entry[], line?: number): TabsState {
  const last = files.length - 1;
  return files.reduce(
    (s, entry, i) =>
      openTab(s, entry, i === last && line !== undefined ? { pin: true, line } : { pin: true }),
    state,
  );
}

/** Texte de la boîte qui confirme le changement de dossier racine demandé par un lien. */
export function linkConfirmText(root: string): { title: string; description: string } {
  const name = trimmed(root).split("/").at(-1) || "/";
  return {
    title: i18n.t("app:workspace.openLink.title", { name }),
    description: i18n.t("app:workspace.openLink.description", { root }),
  };
}
