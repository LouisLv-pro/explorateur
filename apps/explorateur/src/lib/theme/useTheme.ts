import { useEffect, useLayoutEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULT_THEME,
  applyThemeClass,
  loadTheme,
  resolveTheme,
  saveTheme,
  watchSystemTheme,
  type AppliedTheme,
  type ThemeChoice,
} from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// `localStorage` peut lever (accès refusé) : on retombe alors sur Système, sans erreur.
function readStored(storageKey: string): ThemeChoice {
  try {
    return loadTheme(localStorage, storageKey);
  } catch {
    return DEFAULT_THEME;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Pose ou retire la classe `dark` sur <html>, d'un seul coup : les transitions des composants
 * sont coupées le temps du changement (`.theme-switching` dans l'index.css de l'app).
 */
function applyTheme(applied: AppliedTheme): void {
  const root = document.documentElement;
  if (root.classList.contains("dark") === (applied === "dark")) return;
  root.classList.add("theme-switching");
  applyThemeClass(root, applied);
  // Lire un style force le navigateur à appliquer les nouvelles couleurs sans transition,
  // avant de les réautoriser à l'image suivante.
  void getComputedStyle(root).color;
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

/**
 * Appliqué de façon synchrone dans main.tsx avant le premier rendu. (La CSP interdit un
 * script inline dans index.html.) La fenêtre, créée masquée (tauri.conf.json), n'est affichée
 * qu'ensuite, barre de titre comprise : pas de flash clair en sombre.
 */
export function applyInitialTheme(storageKey: string): void {
  const choice = readStored(storageKey);
  applyTheme(resolveTheme(choice, systemPrefersDark()));
  void showWindow(choice);
}

/** Thème de la barre de titre, puis affichage (Rust l'affiche seul après 2 s en secours). */
async function showWindow(choice: ThemeChoice): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const win = getCurrentWindow();
  try {
    await win.setTheme(choice === "system" ? null : choice);
  } catch {
    // Barre de titre non mise à jour : on affiche quand même.
  }
  await win.show().catch(() => {
    // Rust affichera la fenêtre (show_window_fallback, src-tauri/src/lib.rs).
  });
}

/**
 * Barre de titre : `null` rend la main à macOS (Système). Sous macOS, le thème de fenêtre
 * vaut pour toute l'app, et la webview voit alors le même `prefers-color-scheme`.
 */
function setWindowTheme(choice: ThemeChoice): void {
  // Dans le navigateur, applyInitialTheme passe avant l'installation du mock IPC.
  if (!("__TAURI_INTERNALS__" in window)) return;
  // Barre de titre native : macOS la redessine aussitôt. Attendre que la webview ait peint le
  // nouveau thème (deux images) évite qu'elle bascule avant le contenu.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      getCurrentWindow()
        .setTheme(choice === "system" ? null : choice)
        .catch(() => {
          // Barre de titre non mise à jour : le contenu reste au bon thème.
        });
    }),
  );
}

/** Thème choisi, thème appliqué (Système résolu) et choix d'un thème. */
export function useTheme(storageKey: string) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStored(storageKey));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const applied = resolveTheme(choice, systemDark);

  // Toujours suivi : si l'on repasse en Système, la valeur de macOS est déjà à jour.
  useEffect(() => watchSystemTheme(window.matchMedia(DARK_QUERY), setSystemDark), []);

  // Avant la peinture : la classe change dans la même image que les menus du thème.
  useLayoutEffect(() => applyTheme(applied), [applied]);

  useEffect(() => {
    try {
      saveTheme(localStorage, storageKey, choice);
    } catch {
      // Non enregistré : le thème reste valable pour la session.
    }
    setWindowTheme(choice);
  }, [choice, storageKey]);

  return { choice, applied, choose: setChoice };
}
