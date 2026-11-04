// Zoom de l'interface (docs/specs/zoom.md) : paliers et valeur gardée dans le localStorage.
// Logique pure ; l'effet sur la webview est dans `appZoom.ts`.

/** Clé du localStorage : le zoom en pourcentage (`125`). */
export const ZOOM_KEY = "explorateur.zoom";
/** Paliers de `⌘+` et `⌘-`, en pourcentage. */
export const ZOOM_STEPS: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const DEFAULT_ZOOM = 100;

export type ZoomAction = "zoom-in" | "zoom-out" | "zoom-reset";

/** Palier suivant ; le dernier reste. Un niveau hors des paliers est traité comme 100 %. */
export function nextZoom(current: number): number {
  const level = ZOOM_STEPS.includes(current) ? current : DEFAULT_ZOOM;
  return ZOOM_STEPS[ZOOM_STEPS.indexOf(level) + 1] ?? level;
}

/** Palier précédent ; le premier reste. Un niveau hors des paliers est traité comme 100 %. */
export function previousZoom(current: number): number {
  const level = ZOOM_STEPS.includes(current) ? current : DEFAULT_ZOOM;
  return ZOOM_STEPS[ZOOM_STEPS.indexOf(level) - 1] ?? level;
}

/** Niveau visé par une action. */
export function zoomFor(action: ZoomAction, current: number): number {
  if (action === "zoom-in") return nextZoom(current);
  if (action === "zoom-out") return previousZoom(current);
  return DEFAULT_ZOOM;
}

/**
 * Place d'un élément de la page (pixels CSS, `getBoundingClientRect`) en pixels logiques de la
 * fenêtre, où se placent les webviews enfants : un pixel CSS en vaut `factor` (zoom / 100).
 */
export function windowRect(
  rect: { left: number; top: number; width: number; height: number },
  factor: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(rect.left * factor),
    y: Math.round(rect.top * factor),
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  };
}

/** Relit le zoom ; absent, illisible, hors des paliers ou inaccessible : 100 %. */
export function loadZoom(storage: Pick<Storage, "getItem">): number {
  try {
    const raw = storage.getItem(ZOOM_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return raw !== null && raw.trim() === raw && ZOOM_STEPS.includes(value) ? value : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

/** Enregistre le zoom ; un échec est ignoré, il vaut pour la session. */
export function saveZoom(storage: Pick<Storage, "setItem">, percent: number): void {
  try {
    storage.setItem(ZOOM_KEY, String(percent));
  } catch {
    // Non enregistré.
  }
}
