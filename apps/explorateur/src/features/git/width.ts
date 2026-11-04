// Largeur du volet Modifications (docs/specs/git.md) : entre 320 px et la fenêtre moins 360 px,
// 45 % de la fenêtre par défaut, gardée dans le localStorage.

export const GIT_WIDTH_KEY = "explorateur.git-width";
/** Largeur minimale du volet. */
export const MIN_GIT_WIDTH = 320;
/** Place minimale laissée à gauche du volet (arborescence et aperçu). */
export const MIN_REST_WIDTH = 360;
/** En dessous, le mode Scindé n'est pas proposé. */
export const MIN_SPLIT_WIDTH = 640;
const DEFAULT_RATIO = 0.45;

/** Borne `width` entre 320 px et `windowWidth` moins 360 px (le minimum l'emporte), au pixel. */
export function clampWidth(width: number, windowWidth: number): number {
  const max = windowWidth - MIN_REST_WIDTH;
  return Math.round(Math.max(MIN_GIT_WIDTH, Math.min(width, max)));
}

/** 45 % de la fenêtre, borné. */
export function defaultWidth(windowWidth: number): number {
  return clampWidth(windowWidth * DEFAULT_RATIO, windowWidth);
}

/** Largeur affichée : l'enregistrée bornée par la fenêtre actuelle, sinon la valeur par défaut. */
export function panelWidth(stored: number | null, windowWidth: number): number {
  return stored === null ? defaultWidth(windowWidth) : clampWidth(stored, windowWidth);
}

/** Relit la largeur ; absente, invalide ou inaccessible : `null`. */
export function loadWidth(storage: Pick<Storage, "getItem">): number | null {
  try {
    const raw = storage.getItem(GIT_WIDTH_KEY);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Enregistre la largeur ; un échec est ignoré, elle vaut pour la session. */
export function saveWidth(storage: Pick<Storage, "setItem">, width: number): void {
  try {
    storage.setItem(GIT_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Non enregistrée.
  }
}

export type DiffMode = "unified" | "split";
export const GIT_DIFF_MODE_KEY = "explorateur.git-diff-mode";
export const GIT_OPEN_KEY = "explorateur.git-open";

/** Mode affiché : Scindé seulement si le volet fait au moins 640 px. */
export function effectiveMode(mode: DiffMode, width: number): DiffMode {
  return mode === "split" && width >= MIN_SPLIT_WIDTH ? "split" : "unified";
}

/** Mode choisi ; Unifié par défaut (absent, invalide ou inaccessible). */
export function loadDiffMode(storage: Pick<Storage, "getItem">): DiffMode {
  try {
    return storage.getItem(GIT_DIFF_MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function saveDiffMode(storage: Pick<Storage, "setItem">, mode: DiffMode): void {
  try {
    storage.setItem(GIT_DIFF_MODE_KEY, mode);
  } catch {
    // Non enregistré.
  }
}

/** Volet affiché à la dernière session ; masqué par défaut. */
export function loadOpen(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(GIT_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveOpen(storage: Pick<Storage, "setItem">, open: boolean): void {
  try {
    storage.setItem(GIT_OPEN_KEY, String(open));
  } catch {
    // Non enregistré.
  }
}
