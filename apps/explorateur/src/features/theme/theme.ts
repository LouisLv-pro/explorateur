// La logique du mode sombre est dans `@/lib/theme` (copie de l'ancien paquet partagé, décision
// 0004 du monorepo).

import type { AppliedTheme } from "@/lib/theme";

/** Clé du localStorage : le choix enregistré (texte brut `system` / `light` / `dark`). */
export const THEME_KEY = "explorateur.theme";

/** Thème choisi par ⇧⌘L : l'opposé de l'apparence affichée (le choix Système est quitté). */
export function oppositeTheme(applied: AppliedTheme): AppliedTheme {
  return applied === "dark" ? "light" : "dark";
}
