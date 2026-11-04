// Arborescence au clavier (docs/specs/raccourcis.md) : état partagé par `TreePanel` et ses
// entrées. Une seule entrée focalisable à la fois (`tabStop`), déplacement par `treeMove`.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import type { KeyInput, ShortcutAction } from "@/features/shortcuts/shortcuts";
import { treeMove, typeAheadTarget, type TreeDirection, type TreeRow } from "./navigation";

/** Demande de focus de ⇧⌘E : une entrée, ou la première (`path: null`) sans onglet ouvert. */
export type RevealRequest = { path: string | null };

export type TreeKeyboard = {
  /** Entrée focalisable par Tab ; `null` : la première entrée de la racine. */
  tabStop: string | null;
  reveal: RevealRequest | null;
  /** L'entrée demandée par ⇧⌘E a pris le focus. */
  onRevealed: () => void;
  /** Une entrée a pris le focus (clic, flèches, Tab). */
  onFocusEntry: (path: string) => void;
};

export const TreeKeyboardContext = createContext<TreeKeyboard | null>(null);

export function useTreeKeyboard(): TreeKeyboard {
  const value = useContext(TreeKeyboardContext);
  if (!value) throw new Error("useTreeKeyboard hors de <TreePanel>");
  return value;
}

/** Attributs posés sur chaque entrée, lus par `moveFocus` dans l'ordre de l'écran. */
export const ROW_ATTR = "data-tree-row";

const DIRECTIONS: Partial<Record<ShortcutAction, TreeDirection>> = {
  "tree-previous": "previous",
  "tree-next": "next",
  "tree-expand": "expand",
  "tree-collapse": "collapse",
};

/** Direction d'une flèche de l'arborescence, `undefined` pour une autre action. */
export function directionOf(action: ShortcutAction): TreeDirection | undefined {
  return DIRECTIONS[action];
}

/**
 * Applique une flèche depuis l'entrée `from` : focus sur l'entrée visée (défilée à l'écran), ou
 * dossier à déplier ou replier (renvoyé à l'appelant, qui tient l'état `expanded`).
 */
export function moveFocus(
  from: HTMLElement,
  direction: TreeDirection,
  onToggle: (path: string) => void,
): void {
  const visible = visibleRows(from);
  if (visible === null) return;
  const move = treeMove(visible.rows, from.dataset.path ?? "", direction);
  if (move === null) return;
  if (move.kind !== "focus") {
    onToggle(move.path);
    return;
  }
  focusRow(visible, move.path);
}

/** Les entrées affichées de l'arborescence de `from`, dans l'ordre de l'écran (lues dans le DOM). */
function visibleRows(from: HTMLElement) {
  const nav = from.closest("nav");
  if (!nav) return null;
  const buttons = Array.from(nav.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`));
  const rows: TreeRow[] = buttons.map((button) => ({
    path: button.dataset.path ?? "",
    isDir: button.dataset.dir === "true",
    expanded: button.getAttribute("aria-expanded") === "true",
    depth: Number(button.dataset.depth),
  }));
  return { buttons, rows };
}

/** Donne le focus à l'entrée `path` et la fait défiler à l'écran. */
function focusRow(visible: NonNullable<ReturnType<typeof visibleRows>>, path: string): void {
  const target = visible.buttons[visible.rows.findIndex((row) => row.path === path)];
  target?.focus();
  target?.scrollIntoView({ block: "nearest" });
}

/** Silence après la dernière touche qui remet le mot tapé à zéro. */
export const TYPE_AHEAD_RESET_MS = 1000;

/**
 * Caractère que la touche ajoute au mot tapé (saut par frappe), ou `null`. Sans `⌘`, `⌃` ni
 * `⌥` (Maj permise). `?` (aide) et l'espace (clic du bouton) gardent leur rôle en début de mot ;
 * dans un mot commencé, ils en font partie.
 */
export function typeAheadChar(input: KeyInput, inWord: boolean): string | null {
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if ([...input.key].length !== 1) return null;
  if (!inWord && (input.key === "?" || input.key === " ")) return null;
  return input.key;
}

/**
 * Saut par frappe (spec saut-par-frappe.md) : gestionnaire de `keydown` à poser sur l'élément
 * qui contient les entrées. Le mot tapé vit dans une ref (aucun rendu) et repart à zéro
 * `TYPE_AHEAD_RESET_MS` après la dernière touche. La touche prise est consommée
 * (`preventDefault`) : `?` d'un mot commencé n'ouvre pas l'aide.
 */
export function useTypeAhead(): (event: KeyboardEvent<HTMLElement>) => void {
  const word = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return useCallback((event) => {
    // Seules les entrées : pas le champ de nom d'un renommage, ni une touche déjà prise.
    if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    const from = event.target.closest<HTMLElement>(`[${ROW_ATTR}]`);
    if (from === null) return;
    const char = typeAheadChar(event.nativeEvent, word.current !== "");
    if (char === null) return;
    event.preventDefault();
    const first = word.current === "";
    word.current += char;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      word.current = "";
    }, TYPE_AHEAD_RESET_MS);
    const visible = visibleRows(from);
    if (visible === null) return;
    const path = typeAheadTarget(visible.rows, from.dataset.path ?? "", word.current, first);
    if (path !== null) focusRow(visible, path);
  }, []);
}
