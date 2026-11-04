import type { Entry, IssueState, PreviewKind } from "@/bindings";
import { previewKindOf } from "@/features/quick-open/match";

/** Un onglet. `pinned: false` : onglet provisoire (au plus un à la fois). */
export type Tab = {
  /**
   * Identité stable de l'onglet, `key` de son volet : un renommage change `path` mais garde
   * l'état du volet (défilement). Sert de repli à `path` quand elle est absente.
   */
  id?: string;
  /** Chemin absolu du fichier (identifiant de l'onglet). */
  path: string;
  name: string;
  pinned: boolean;
  /** Type d'aperçu de l'entrée ouverte (icône de l'onglet). */
  previewKind?: PreviewKind | null;
  /** Ligne à montrer (résultat de recherche dans le contenu), à partir de 1. */
  line?: number;
  /** Change à chaque demande de ligne : re-déclenche l'aller à la ligne, même ligne répétée. */
  lineSeq?: number;
  /** Modifications non enregistrées dans l'éditeur. */
  dirty?: boolean;
  /**
   * Aperçu d'un serveur local (spec serveurs-locaux.md) : clé du serveur. `path` vaut alors
   * `serverTabPath(server)`, qui n'est pas un chemin de fichier.
   */
  server?: string;
  /**
   * Issue GitHub ouverte en lecture (spec issues-github.md) : son numéro. `path` vaut alors
   * `issueTabPath(repo, issue)`, qui n'est pas un chemin de fichier.
   */
  issue?: number;
  /** État de l'issue à l'ouverture (icône de l'onglet, avant la lecture de l'issue). */
  issueState?: IssueState;
};

/** Identifiant (`path` et `id`) de l'onglet d'une issue : `issue:<owner/repo>#<N>`. */
export function issueTabPath(repo: string, number: number): string {
  return `issue:${repo}#${number}`;
}

/** Dépôt (`owner/repo`) d'un chemin d'onglet d'issue. */
export function issueTabRepo(path: string): string {
  return path.replace(/^issue:/, "").replace(/#\d+$/, "");
}

/**
 * Ouvre l'issue `number` du dépôt `repo`, titrée `name` : onglet provisoire (remplace l'ancien
 * provisoire) ou épinglé (`pin`), comme un fichier. Déjà ouverte : son onglet devient actif (et
 * épinglé avec `pin`). Pure.
 */
export function openIssueTab(
  state: TabsState,
  repo: string,
  number: number,
  name: string,
  issueState: IssueState,
  options: { pin?: boolean } = {},
): TabsState {
  const { pin = false } = options;
  const path = issueTabPath(repo, number);
  const existing = state.tabs.find((t) => t.path === path);
  if (existing) {
    const tabs =
      pin && !existing.pinned
        ? state.tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t))
        : state.tabs;
    return { tabs, active: path };
  }
  const tab: Tab = { id: path, path, name, pinned: pin, issue: number, issueState };
  const provisional = state.tabs.findIndex((t) => !t.pinned);
  if (!pin && provisional >= 0) {
    return { tabs: state.tabs.map((t, i) => (i === provisional ? tab : t)), active: path };
  }
  return { tabs: insertAfterActive(state, tab), active: path };
}

/** Identifiant (`path` et `id`) de l'onglet d'aperçu d'un serveur : jamais un chemin absolu. */
export function serverTabPath(serverKey: string): string {
  return `server:${serverKey}`;
}

/**
 * Ouvre l'aperçu du serveur `serverKey`, titré `name`, en onglet épinglé et actif. Déjà
 * ouvert : son onglet devient actif, sans second onglet. Pure.
 */
export function openServerTab(state: TabsState, serverKey: string, name: string): TabsState {
  const path = serverTabPath(serverKey);
  if (state.tabs.some((t) => t.path === path)) return { ...state, active: path };
  const tab: Tab = { id: path, path, name, pinned: true, server: serverKey };
  return { tabs: insertAfterActive(state, tab), active: path };
}

/** Clé de l'onglet : son `id`, à défaut son chemin. Clé du volet et du document de l'éditeur. */
export function tabKey(tab: Tab): string {
  return tab.id ?? tab.path;
}

/**
 * Marque l'onglet `path` modifié ou non. Modifier un onglet provisoire l'épingle (il ne doit
 * pas être remplacé par le prochain fichier ouvert). Renvoie `state` tel quel si rien ne change.
 */
export function setTabDirty(state: TabsState, path: string, dirty: boolean): TabsState {
  const tab = state.tabs.find((t) => t.path === path);
  if (!tab || (Boolean(tab.dirty) === dirty && (!dirty || tab.pinned))) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.path === path ? { ...t, dirty, pinned: t.pinned || dirty } : t)),
  };
}

/** Onglets modifiés de `path` ou des fichiers sous le dossier `path`. */
export function dirtyTabsUnder(tabs: Tab[], path: string): Tab[] {
  return tabs.filter((t) => t.dirty && isUnder(t.path, path));
}

export type TabsState = {
  tabs: Tab[];
  /** Chemin de l'onglet actif. */
  active: string | null;
};

/** Entrée (fichier) correspondant à un onglet. */
export function entryOfTab(tab: Tab): Entry {
  return { name: tab.name, path: tab.path, is_dir: false, preview_kind: tab.previewKind ?? null };
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null };

type OpenOptions = { pin?: boolean; line?: number };

/** Insère `tab` juste à droite de l'onglet actif, à la fin sans onglet actif. */
function insertAfterActive(state: TabsState, tab: Tab): Tab[] {
  const activeIndex = state.tabs.findIndex((t) => t.path === state.active);
  const at = activeIndex < 0 ? state.tabs.length : activeIndex + 1;
  return [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)];
}

/** Ouvre `entry` : onglet provisoire (remplace l'ancien) ou épinglé (`pin`). Pure. */
export function openTab(state: TabsState, entry: Entry, options: OpenOptions): TabsState {
  const { pin = false, line } = options;
  const existing = state.tabs.find((t) => t.path === entry.path);

  if (existing) {
    const tabs = state.tabs.map((t) => {
      if (t.path !== entry.path) return t;
      const next: Tab = { ...t, pinned: t.pinned || pin };
      if (line !== undefined) {
        next.line = line;
        next.lineSeq = (t.lineSeq ?? 0) + 1;
      }
      return next;
    });
    return { tabs, active: entry.path };
  }

  const tab: Tab = {
    id: crypto.randomUUID(),
    path: entry.path,
    name: entry.name,
    pinned: pin,
    previewKind: entry.preview_kind,
  };
  if (line !== undefined) {
    tab.line = line;
    tab.lineSeq = 1;
  }

  const provisional = state.tabs.findIndex((t) => !t.pinned);
  if (!pin && provisional >= 0) {
    const tabs = state.tabs.map((t, i) => (i === provisional ? tab : t));
    return { tabs, active: tab.path };
  }
  return { tabs: insertAfterActive(state, tab), active: tab.path };
}

export function pinTab(state: TabsState, path: string): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t)) };
}

/** Ferme `path` ; s'il était actif, l'onglet de droite devient actif, sinon celui de gauche. */
export function closeTab(state: TabsState, path: string): TabsState {
  const index = state.tabs.findIndex((t) => t.path === path);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.path !== path);
  if (state.active !== path) return { tabs, active: state.active };
  const neighbour = tabs[index] ?? tabs[index - 1];
  return { tabs, active: neighbour?.path ?? null };
}

/** Vrai si `path` est `base` ou se trouve dans le dossier `base` (`docs` ne couvre pas `docs-old`). */
export function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Ferme l'onglet de `path` et ceux des fichiers sous `path` (dossier mis à la corbeille).
 * Si l'onglet actif disparaît, le premier onglet restant à sa droite devient actif, sinon le
 * dernier restant à sa gauche (comme `closeTab`).
 */
export function closeTabsUnder(state: TabsState, path: string): TabsState {
  const tabs = state.tabs.filter((t) => !isUnder(t.path, path));
  if (tabs.length === state.tabs.length) return state;
  if (state.active === null || !isUnder(state.active, path)) return { tabs, active: state.active };
  const activeIndex = state.tabs.findIndex((t) => t.path === state.active);
  const right = state.tabs.slice(activeIndex + 1).find((t) => !isUnder(t.path, path));
  const left = state.tabs
    .slice(0, activeIndex)
    .reverse()
    .find((t) => !isUnder(t.path, path));
  return { tabs, active: (right ?? left)?.path ?? null };
}

/**
 * Suit un renommage de `from` en `to` : l'onglet de `from` ou d'un fichier sous `from` prend le
 * nouveau chemin, en gardant sa place, son état épinglé et ses autres propriétés. Son nom et
 * son type d'aperçu suivent le nouveau nom.
 */
export function renameTabs(state: TabsState, from: string, to: string): TabsState {
  if (!state.tabs.some((t) => isUnder(t.path, from))) return state;
  const move = (path: string) => (isUnder(path, from) ? `${to}${path.slice(from.length)}` : path);
  const tabs = state.tabs.map((t): Tab => {
    if (!isUnder(t.path, from)) return t;
    const path = move(t.path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { ...t, path, name, previewKind: previewKindOf(name) };
  });
  return { tabs, active: state.active === null ? null : move(state.active) };
}

export function closeOtherTabs(state: TabsState, path: string): TabsState {
  const kept = state.tabs.filter((t) => t.path === path);
  return { tabs: kept, active: kept.length > 0 ? path : null };
}

export function activateTab(state: TabsState, path: string): TabsState {
  return { ...state, active: path };
}

/**
 * Active l'onglet de rang `rank` (à partir de 1) ou le dernier (`⌘1` à `⌘8`, `⌘9`). Renvoie
 * `state` tel quel s'il n'y a pas d'onglet à ce rang.
 */
export function activateTabAt(state: TabsState, rank: number | "last"): TabsState {
  const tab = rank === "last" ? state.tabs.at(-1) : state.tabs[rank - 1];
  if (!tab || tab.path === state.active) return state;
  return { ...state, active: tab.path };
}

/** Onglet suivant (`1`) ou précédent (`-1`), circulaire. */
export function nextTab(state: TabsState, direction: 1 | -1): TabsState {
  const count = state.tabs.length;
  if (count === 0) return state;
  const index = state.tabs.findIndex((t) => t.path === state.active);
  // Sans actif : `1` va au premier onglet, `-1` au dernier.
  const target =
    index < 0 ? (direction === 1 ? 0 : count - 1) : (index + direction + count) % count;
  return { ...state, active: state.tabs[target]?.path ?? null };
}
