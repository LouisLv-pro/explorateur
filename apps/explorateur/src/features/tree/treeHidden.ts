// Arborescence masquée (⌥⌘S, docs/specs/raccourcis.md) : état gardé dans le localStorage.
import { useEffect, useState } from "react";

/** Clé du localStorage : `true` quand l'arborescence est masquée. */
export const TREE_HIDDEN_KEY = "explorateur.tree-hidden";

/** Relit l'état ; absent, illisible ou inaccessible : affichée. */
export function loadTreeHidden(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(TREE_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

/** Enregistre l'état ; un échec (stockage refusé) est ignoré, l'état vaut pour la session. */
export function saveTreeHidden(storage: Pick<Storage, "setItem">, hidden: boolean): void {
  try {
    storage.setItem(TREE_HIDDEN_KEY, String(hidden));
  } catch {
    // Non enregistré.
  }
}

// L'accès à `localStorage` lui-même peut lever (stockage refusé).
function readHidden(): boolean {
  try {
    return loadTreeHidden(localStorage);
  } catch {
    return false;
  }
}

/** État masqué de l'arborescence, relu au lancement et enregistré à chaque changement. */
export function useTreeHidden() {
  const [hidden, setHidden] = useState(readHidden);
  useEffect(() => {
    try {
      saveTreeHidden(localStorage, hidden);
    } catch {
      // Non enregistré : l'état vaut pour la session.
    }
  }, [hidden]);
  return [hidden, setHidden] as const;
}
