// Hauteur du panneau Terminal (docs/specs/terminal.md) : bornée par la zone d'aperçu, 40 % par
// défaut, gardée dans le localStorage.

export const TERMINAL_HEIGHT_KEY = "explorateur.terminal-height";
/** Hauteur minimale du panneau, et place minimale laissée à l'aperçu au-dessus. */
export const MIN_TERMINAL_HEIGHT = 120;
const DEFAULT_RATIO = 0.4;

/** Borne `height` entre 120 px et `area` moins 120 px (le minimum l'emporte), au pixel près. */
export function clampHeight(height: number, area: number): number {
  const max = area - MIN_TERMINAL_HEIGHT;
  return Math.round(Math.max(MIN_TERMINAL_HEIGHT, Math.min(height, max)));
}

/** 40 % de la zone d'aperçu, borné. */
export function defaultHeight(area: number): number {
  return clampHeight(area * DEFAULT_RATIO, area);
}

/** Hauteur affichée : l'enregistrée bornée par la zone actuelle, sinon la valeur par défaut. */
export function panelHeight(stored: number | null, area: number): number {
  return stored === null ? defaultHeight(area) : clampHeight(stored, area);
}

/** Relit la hauteur ; absente, invalide ou inaccessible : `null`. */
export function loadHeight(storage: Pick<Storage, "getItem">): number | null {
  try {
    const raw = storage.getItem(TERMINAL_HEIGHT_KEY);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Enregistre la hauteur ; un échec est ignoré, elle vaut pour la session. */
export function saveHeight(storage: Pick<Storage, "setItem">, height: number): void {
  try {
    storage.setItem(TERMINAL_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    // Non enregistrée.
  }
}
