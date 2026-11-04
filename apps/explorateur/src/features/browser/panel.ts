// Colonne de droite (docs/specs/navigateur.md) : panneau navigateur et volet Modifications
// sont exclusifs. État affiché gardé dans `explorateur.browser-open` et `explorateur.git-open`.
import { GIT_OPEN_KEY, clampWidth, defaultWidth } from "../git/width";

/** Ce qu'affiche la colonne de droite. */
export type SidePanel = "git" | "browser" | null;

export const BROWSER_OPEN_KEY = "explorateur.browser-open";
export const BROWSER_WIDTH_KEY = "explorateur.browser-width";

/** Bouton ou raccourci : affiche `panel` (masque l'autre), ou le masque s'il est déjà affiché. */
export function toggleSidePanel(current: SidePanel, panel: "git" | "browser"): SidePanel {
  return current === panel ? null : panel;
}

/** Affiche `panel` sans jamais le masquer (⌘clic sur une URL du terminal). */
export function showSidePanel(_current: SidePanel, panel: "git" | "browser"): SidePanel {
  return panel;
}

function readFlag(storage: Pick<Storage, "getItem">, key: string): boolean {
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Relit `explorateur.browser-open` et `explorateur.git-open` ; rien d'affiché par défaut. */
export function loadSidePanel(storage: Pick<Storage, "getItem">): SidePanel {
  if (readFlag(storage, BROWSER_OPEN_KEY)) return "browser";
  if (readFlag(storage, GIT_OPEN_KEY)) return "git";
  return null;
}

/** Écrit les deux clés (`"true"` / `"false"`) ; un échec est ignoré. */
export function saveSidePanel(storage: Pick<Storage, "setItem">, panel: SidePanel): void {
  try {
    storage.setItem(BROWSER_OPEN_KEY, String(panel === "browser"));
    storage.setItem(GIT_OPEN_KEY, String(panel === "git"));
  } catch {
    // Non enregistré : vaut pour la session.
  }
}

/** Largeur affichée : l'enregistrée bornée par la fenêtre actuelle, sinon 45 % de la fenêtre. */
export function browserWidth(stored: number | null, windowWidth: number): number {
  return stored === null ? defaultWidth(windowWidth) : clampWidth(stored, windowWidth);
}

/** Relit la largeur ; absente, invalide ou inaccessible : `null`. */
export function loadBrowserWidth(storage: Pick<Storage, "getItem">): number | null {
  try {
    const raw = storage.getItem(BROWSER_WIDTH_KEY);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBrowserWidth(storage: Pick<Storage, "setItem">, width: number): void {
  try {
    storage.setItem(BROWSER_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Non enregistrée.
  }
}
