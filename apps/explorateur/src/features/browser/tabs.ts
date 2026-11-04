// Onglets du panneau navigateur (docs/specs/navigateur.md) : fonctions pures.

/** Onglet du navigateur. `url` vide : onglet vide (« Nouvel onglet »). `title` vide : pas encore lu. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

/** Toujours au moins un onglet ; `active` est l'`id` de l'un d'eux. */
export interface BrowserTabsState {
  tabs: BrowserTab[];
  active: string;
}

export const BROWSER_TABS_KEY = "explorateur.browser-tabs";

const blankTab = (id: string): BrowserTab => ({ id, url: "", title: "" });

/** Un seul onglet vide, actif. */
export function newBrowserTabs(id: string): BrowserTabsState {
  return { tabs: [blankTab(id)], active: id };
}

/** Ajoute à la fin un onglet `id` chargeant `url` (vide par défaut) et l'active. */
export function openBrowserTab(state: BrowserTabsState, id: string, url = ""): BrowserTabsState {
  return { tabs: [...state.tabs, { id, url, title: "" }], active: id };
}

/** Active l'onglet `id` ; inconnu : état inchangé. */
export function activateBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, active: id } : state;
}

/**
 * Ferme l'onglet `id`. S'il était actif, celui de droite devient actif, sinon celui de gauche.
 * Le dernier fermé laisse un onglet vide d'identifiant `newId`. `id` inconnu : état inchangé.
 */
export function closeBrowserTab(
  state: BrowserTabsState,
  id: string,
  newId: string,
): BrowserTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0) return newBrowserTabs(newId);
  if (state.active !== id) return { tabs, active: state.active };
  // Après retrait, le voisin de droite a pris le rang `index` ; sinon, le dernier restant.
  const next = tabs[index] ?? tabs[tabs.length - 1];
  return { tabs, active: next?.id ?? state.active };
}

/** Enregistre `{ urls, active }` (`active` : rang de l'onglet actif) ; un échec est ignoré. */
export function saveBrowserTabs(storage: Pick<Storage, "setItem">, state: BrowserTabsState): void {
  try {
    const active = Math.max(
      0,
      state.tabs.findIndex((tab) => tab.id === state.active),
    );
    const urls = state.tabs.map((tab) => tab.url);
    storage.setItem(BROWSER_TABS_KEY, JSON.stringify({ urls, active }));
  } catch {
    // Non enregistré : vaut pour la session.
  }
}

/**
 * Relit les onglets (titres vides, identifiants tirés de `newId`). Absent, illisible ou
 * inaccessible : un seul onglet vide. Rang actif hors limites : premier onglet.
 */
export function loadBrowserTabs(
  storage: Pick<Storage, "getItem">,
  newId: () => string,
): BrowserTabsState {
  const saved = readSaved(storage);
  if (saved === null) return newBrowserTabs(newId());
  const tabs = saved.urls.map((url) => ({ id: newId(), url, title: "" }));
  const active = tabs[saved.active] ?? tabs[0];
  return { tabs, active: active?.id ?? "" };
}

function readSaved(storage: Pick<Storage, "getItem">): { urls: string[]; active: number } | null {
  try {
    const raw = storage.getItem(BROWSER_TABS_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { urls, active } = value as { urls?: unknown; active?: unknown };
    if (!Array.isArray(urls) || urls.length === 0) return null;
    if (!urls.every((url): url is string => typeof url === "string")) return null;
    const valid =
      typeof active === "number" && Number.isInteger(active) && active >= 0 && active < urls.length;
    return { urls, active: valid ? active : 0 };
  } catch {
    return null;
  }
}
