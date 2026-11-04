import i18n from "@/i18n";
import type { BrowserTab } from "./tabs";

/** Hôte d'une URL (`github.com`), sinon l'URL telle quelle. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Libellé d'un onglet : titre de la page, sinon hôte, sinon « Nouvel onglet » (langue active). */
export function tabLabel(tab: BrowserTab): string {
  if (tab.title !== "") return tab.title;
  return tab.url === "" ? i18n.t("browser:newTab") : hostOf(tab.url);
}
