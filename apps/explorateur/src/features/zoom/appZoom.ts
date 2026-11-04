// Zoom de l'interface (docs/specs/zoom.md) : applique le niveau à la webview principale et le
// garde en mémoire pour ceux qui doivent convertir des pixels CSS (webviews enfants du navigateur).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { DEFAULT_ZOOM, loadZoom, saveZoom } from "./zoom";

let current = DEFAULT_ZOOM;

/** Zoom appliqué, en pourcentage. */
export function currentZoom(): number {
  return current;
}

/**
 * Facteur de zoom (1 = 100 %) : un pixel CSS de la page vaut ce nombre de pixels logiques de la
 * fenêtre. Les webviews enfants, placées en pixels logiques, multiplient leurs mesures par lui.
 */
export function zoomFactor(): number {
  return current / 100;
}

/** Pose le zoom sur la webview principale ; `false` si Tauri refuse (le niveau reste inchangé). */
async function setWebviewZoom(percent: number): Promise<boolean> {
  try {
    await getCurrentWebview().setZoom(percent / 100);
    return true;
  } catch (error) {
    console.error("zoom non appliqué", error);
    return false;
  }
}

/**
 * Applique et enregistre `percent`. La mémoire est mise à jour avant l'appel : les mesures prises
 * pendant que la webview change de taille utilisent déjà le nouveau facteur. Une fois posé, un
 * `resize` force les vues qui placent des webviews enfants à se recalculer.
 */
export async function applyZoom(percent: number): Promise<void> {
  const previous = current;
  current = percent;
  if (await setWebviewZoom(percent)) {
    try {
      saveZoom(localStorage, percent);
    } catch {
      // Non enregistré : le zoom vaut pour la session.
    }
  } else {
    current = previous;
  }
  window.dispatchEvent(new Event("resize"));
}

/** Au lancement, avant le premier rendu : relit et applique le zoom enregistré (100 % : rien). */
export async function applyInitialZoom(): Promise<void> {
  let percent = DEFAULT_ZOOM;
  try {
    percent = loadZoom(localStorage);
  } catch {
    // Stockage inaccessible : 100 %.
  }
  if (percent === DEFAULT_ZOOM) return;
  current = percent;
  if (!(await setWebviewZoom(percent))) current = DEFAULT_ZOOM;
}
