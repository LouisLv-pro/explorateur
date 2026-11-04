// État des onglets de `WorkspaceProvider` avec ce qui les suit (docs/specs/continuite.md) :
// historique ⌃⌘← / ⌃⌘→, fichiers récents, et à quel dossier racine la session appartient.
// Fonctions pures, sans React.
import {
  EMPTY_HISTORY,
  step,
  visit,
  type History,
  type HistoryEntry,
} from "@/features/history/history";
import { isFileTab, touchRecent, type RecentFile } from "@/features/session/session";
import { EMPTY_TABS, activateTab, openTab, type Tab, type TabsState } from "@/features/tabs/tabs";

export type SessionState = {
  tabs: TabsState;
  history: History;
  /** Fichiers récemment activés, du plus récent au plus ancien. */
  recent: RecentFile[];
  /**
   * Dossier racine à qui appartiennent ces onglets : ils s'enregistrent dans sa session. `null`
   * (accueil) : rien ne s'enregistre. La remise à zéro en changeant de dossier le change dans
   * la même mise à jour, donc elle n'écrase jamais la session d'un autre dossier.
   */
  owner: string | null;
  /** Rétablissement en cours : rien ne s'enregistre avant qu'il finisse ou soit abandonné. */
  restoring: boolean;
};

export const EMPTY_STATE: SessionState = {
  tabs: EMPTY_TABS,
  history: EMPTY_HISTORY,
  recent: [],
  owner: null,
  restoring: false,
};

/** Entrée d'historique d'un onglet. */
export function historyEntryOf(tab: Tab): HistoryEntry {
  return {
    path: tab.path,
    name: tab.name,
    previewKind: tab.previewKind ?? null,
    file: isFileTab(tab),
  };
}

/**
 * Applique un changement d'onglets : l'onglet devenu actif entre dans l'historique (et dans
 * les récents s'il s'agit d'un fichier). Un changement fait pendant le rétablissement
 * l'abandonne : ces onglets-là l'emportent. Onglets inchangés : `state` tel quel.
 */
export function withTabs(state: SessionState, tabs: TabsState): SessionState {
  if (tabs === state.tabs) return state;
  let { history, recent } = state;
  if (tabs.active !== null && tabs.active !== state.tabs.active) {
    const tab = tabs.tabs.find((t) => t.path === tabs.active);
    if (tab) {
      history = visit(history, historyEntryOf(tab));
      if (isFileTab(tab)) {
        recent = touchRecent(recent, {
          path: tab.path,
          name: tab.name,
          previewKind: tab.previewKind ?? null,
        });
      }
    }
  }
  return { ...state, tabs, history, recent, restoring: false };
}

/**
 * ⌃⌘← (`-1`) ou ⌃⌘→ (`1`) : active l'onglet de l'étape, ou rouvre son fichier en onglet
 * provisoire s'il est fermé. Le déplacement n'ajoute rien à l'historique.
 */
export function moveInHistory(state: SessionState, direction: -1 | 1): SessionState {
  const isOpen = (path: string) => state.tabs.tabs.some((t) => t.path === path);
  const target = step(state.history, direction, isOpen);
  if (target === null) return state;
  const { entry } = target;
  const tabs = isOpen(entry.path)
    ? activateTab(state.tabs, entry.path)
    : openTab(
        state.tabs,
        { name: entry.name, path: entry.path, is_dir: false, preview_kind: entry.previewKind },
        {},
      );
  // La nouvelle position désigne déjà cet onglet : `visit` n'y ajoute rien.
  return withTabs({ ...state, history: target.history }, tabs);
}

/** Vrai si ⌃⌘← (`-1`) ou ⌃⌘→ (`1`) ont un effet. */
export function canMove(state: SessionState, direction: -1 | 1): boolean {
  const isOpen = (path: string) => state.tabs.tabs.some((t) => t.path === path);
  return step(state.history, direction, isOpen) !== null;
}
