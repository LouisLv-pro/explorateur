// Historique des onglets activés (docs/specs/continuite.md) : ⌃⌘← revient au fichier consulté
// avant, ⌃⌘→ repart vers le suivant, comme un navigateur. Module pur, sans React.
import type { PreviewKind } from "@/bindings";
import { previewKindOf } from "@/features/quick-open/match";
import { isUnder } from "@/features/tabs/tabs";

/** Entrées gardées au plus : la plus ancienne part la première. */
export const MAX_HISTORY = 50;

/** Un onglet activé : de quoi le retrouver, ou le rouvrir s'il s'agit d'un fichier. */
export type HistoryEntry = {
  path: string;
  name: string;
  previewKind: PreviewKind | null;
  /** Fichier (rouvert s'il est fermé) ; un serveur ou une issue fermés sont sautés. */
  file: boolean;
};

export type History = {
  entries: HistoryEntry[];
  /** Position courante, `-1` quand l'historique est vide. */
  index: number;
};

export const EMPTY_HISTORY: History = { entries: [], index: -1 };

/**
 * Ajoute l'onglet activé après la position courante : la suite vers l'avant s'efface. Le même
 * onglet que le courant n'ajoute rien (ni doublon consécutif, ni retour à l'étape d'un déplacement).
 */
export function visit(history: History, entry: HistoryEntry): History {
  if (history.entries[history.index]?.path === entry.path) return history;
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-MAX_HISTORY);
  return { entries, index: entries.length - 1 };
}

/** Étape atteinte par un déplacement : le nouvel historique et l'onglet à activer. */
export type Step = { history: History; entry: HistoryEntry };

/**
 * Recule (`-1`) ou avance (`1`) jusqu'à l'entrée la plus proche qui est encore ouverte
 * (`isOpen`) ou qui est un fichier (il se rouvrira). `null` : rien dans ce sens.
 */
export function step(
  history: History,
  direction: -1 | 1,
  isOpen: (path: string) => boolean,
): Step | null {
  for (let i = history.index + direction; i >= 0 && i < history.entries.length; i += direction) {
    const entry = history.entries[i];
    if (entry && (entry.file || isOpen(entry.path))) {
      return { history: { ...history, index: i }, entry };
    }
  }
  return null;
}

/** Vrai si ⌃⌘← (`-1`) ou ⌃⌘→ (`1`) ont un effet. */
export function canStep(
  history: History,
  direction: -1 | 1,
  isOpen: (path: string) => boolean,
): boolean {
  return step(history, direction, isOpen) !== null;
}

/** Les entrées de `from` ou d'un fichier sous `from` suivent son renommage en `to`. */
export function renameHistory(history: History, from: string, to: string): History {
  if (!history.entries.some((e) => isUnder(e.path, from))) return history;
  const entries = history.entries.map((e): HistoryEntry => {
    if (!isUnder(e.path, from)) return e;
    const path = `${to}${e.path.slice(from.length)}`;
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { ...e, path, name, previewKind: previewKindOf(name) };
  });
  return { ...history, entries };
}

/**
 * Retire `path` et les fichiers sous le dossier `path` (corbeille). Deux entrées devenues
 * voisines et identiques n'en font plus qu'une ; la position reste sur la même entrée, ou recule
 * sur celle d'avant si la courante est retirée.
 */
export function removeHistoryUnder(history: History, path: string): History {
  if (!history.entries.some((e) => isUnder(e.path, path))) return history;
  const entries: HistoryEntry[] = [];
  let index = -1;
  history.entries.forEach((entry, i) => {
    if (!isUnder(entry.path, path) && entries.at(-1)?.path !== entry.path) entries.push(entry);
    if (i === history.index) index = entries.length - 1;
  });
  return { entries, index: entries.length > 0 ? Math.max(0, index) : -1 };
}
