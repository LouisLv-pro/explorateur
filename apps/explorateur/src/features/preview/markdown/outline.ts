// Sommaire d'un document Markdown (docs/specs/sommaire-markdown.md) : fonctions pures et
// préférence d'affichage, partagée entre le bouton de l'en-tête et le panneau.
import { useSyncExternalStore } from "react";

/** Un titre du document rendu : `h1` à `h3`, texte tel qu'affiché. */
export type OutlineItem = { level: 1 | 2 | 3; text: string };

/** Retrait d'un niveau, relatif au plus haut niveau présent dans le document. */
export function indentOf(level: number, minLevel: number): number {
  return level - minLevel;
}

/**
 * Rang du titre lu. `tops` : haut de chaque titre relatif au haut de la zone visible (`null` :
 * titre masqué). Le titre lu est le dernier dont le haut a passé `offset`, le premier visible
 * avant tout titre, le dernier visible en bas du document. `-1` quand aucun titre n'est visible.
 */
export function activeHeading(
  tops: readonly (number | null)[],
  offset: number,
  atBottom: boolean,
): number {
  let first = -1;
  let last = -1;
  let passed = -1;
  tops.forEach((top, rank) => {
    if (top === null) return;
    if (first === -1) first = rank;
    last = rank;
    if (top <= offset) passed = rank;
  });
  if (atBottom) return last;
  return passed === -1 ? first : passed;
}

/**
 * Le défileur est-il tout en bas ? Faux pour un document qui tient sans défiler : il n'a pas de
 * bas à atteindre, le titre lu y reste le premier.
 */
export function isAtBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight > clientHeight && scrollTop + clientHeight >= scrollHeight - 2;
}

/** Clé du localStorage : `false` quand le sommaire est masqué. */
export const OUTLINE_KEY = "explorateur.markdown-outline";

/** Relit le choix ; absent, illisible ou inaccessible : affiché. */
export function loadOutlineShown(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(OUTLINE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Enregistre le choix ; un échec (stockage refusé) est ignoré, le choix vaut pour la session. */
export function saveOutlineShown(storage: Pick<Storage, "setItem">, shown: boolean): void {
  try {
    storage.setItem(OUTLINE_KEY, String(shown));
  } catch {
    // Non enregistré.
  }
}

// Petit store : le bouton de l'en-tête (`FilePane`) et le panneau (`MarkdownView`) lisent le
// même choix. Un refus d'accès à `localStorage` retombe sur la valeur de la session.
const listeners = new Set<() => void>();
let sessionValue = true;

function readShown(): boolean {
  try {
    return loadOutlineShown(localStorage);
  } catch {
    return sessionValue;
  }
}

/** Fixe le choix, l'enregistre et prévient les composants qui l'affichent. */
export function setOutlineShown(shown: boolean): void {
  sessionValue = shown;
  try {
    saveOutlineShown(localStorage, shown);
  } catch {
    // Non enregistré.
  }
  listeners.forEach((listener) => listener());
}

/** Inverse le choix (raccourci ⌥⌘T). */
export function toggleOutlineShown(): void {
  setOutlineShown(!readShown());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Le sommaire est-il demandé ? Valable pour tous les Markdown, relu au lancement. */
export function useOutlineShown(): boolean {
  return useSyncExternalStore(subscribe, readShown, () => true);
}
