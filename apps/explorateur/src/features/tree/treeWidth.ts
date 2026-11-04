// Largeur de l'arborescence (docs/specs/largeur-arborescence.md) : 280 à 560 px, gardée dans le
// localStorage à la fin d'un redimensionnement, pour tous les dossiers.

/** Clé du localStorage : la largeur en pixels. */
export const TREE_WIDTH_KEY = "explorateur.tree-width";
// 280 px : les cinq boutons de l'en-tête en prennent environ 160, il reste de la place pour
// le début du nom du dossier racine (tronqué au-delà, nom entier en infobulle).
export const DEFAULT_TREE_WIDTH = 280;
export const MIN_TREE_WIDTH = 280;
export const MAX_TREE_WIDTH = 560;

/** Borne la largeur entre 280 et 560 px, au pixel. */
export function clampTreeWidth(width: number): number {
  return Math.round(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width)));
}

/** Relit la largeur, bornée ; absente, illisible ou inaccessible : 280 px. */
export function loadTreeWidth(storage: Pick<Storage, "getItem">): number {
  try {
    const raw = storage.getItem(TREE_WIDTH_KEY);
    if (raw === null || raw.trim() === "") return DEFAULT_TREE_WIDTH;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? clampTreeWidth(value) : DEFAULT_TREE_WIDTH;
  } catch {
    return DEFAULT_TREE_WIDTH;
  }
}

/** Enregistre la largeur ; un échec est ignoré, elle vaut pour la session. */
export function saveTreeWidth(storage: Pick<Storage, "setItem">, width: number): void {
  try {
    storage.setItem(TREE_WIDTH_KEY, String(clampTreeWidth(width)));
  } catch {
    // Non enregistrée.
  }
}

/** Largeur au montage du panneau. L'accès à `localStorage` lui-même peut lever. */
export function readTreeWidth(): number {
  try {
    return loadTreeWidth(localStorage);
  } catch {
    return DEFAULT_TREE_WIDTH;
  }
}

/** Enregistre la largeur à la fin d'un redimensionnement. */
export function writeTreeWidth(width: number): void {
  try {
    saveTreeWidth(localStorage, width);
  } catch {
    // Non enregistrée : elle vaut pour la session.
  }
}
