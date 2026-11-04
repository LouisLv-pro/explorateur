// Session d'un dossier racine (docs/specs/continuite.md) : onglets de fichiers, onglet actif et
// fichiers récents, gardés dans le localStorage. Fonctions pures, sans React.
import type { PreviewKind } from "@/bindings";
import { previewKindOf } from "@/features/quick-open/match";
import { isUnder, type Tab, type TabsState } from "@/features/tabs/tabs";

/** Clé du localStorage : un objet par chemin de dossier racine. */
export const SESSIONS_KEY = "explorateur.sessions";
/** Dossiers racines gardés au plus : le moins récemment utilisé part le premier. */
export const MAX_SESSIONS = 20;
/** Fichiers récents gardés au plus par dossier racine. */
export const MAX_RECENT = 20;

/** Onglet de fichier mémorisé : ni ligne demandée, ni état modifié. */
export type StoredTab = {
  path: string;
  name: string;
  pinned: boolean;
  previewKind: PreviewKind | null;
};

/** Fichier récemment activé (⌘P, requête vide). */
export type RecentFile = { path: string; name: string; previewKind: PreviewKind | null };

export type StoredSession = {
  tabs: StoredTab[];
  /** Chemin de l'onglet actif au moment de l'enregistrement (peut être un serveur, écarté). */
  active: string | null;
  /** Du plus récent au plus ancien. */
  recent: RecentFile[];
};

export const EMPTY_SESSION: StoredSession = { tabs: [], active: null, recent: [] };

/** Vrai pour un onglet de fichier (ni aperçu de serveur, ni issue). */
export function isFileTab(tab: Tab): boolean {
  return tab.server === undefined && tab.issue === undefined;
}

/** Ce qui se mémorise des onglets : les onglets de fichiers seulement. */
export function sessionOf(state: TabsState, recent: RecentFile[]): StoredSession {
  return {
    tabs: state.tabs.filter(isFileTab).map((t) => ({
      path: t.path,
      name: t.name,
      pinned: t.pinned,
      previewKind: t.previewKind ?? null,
    })),
    active: state.active,
    recent,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readFile(value: unknown): RecentFile | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.name !== "string") {
    return null;
  }
  const previewKind = typeof value.previewKind === "string" ? value.previewKind : null;
  return { path: value.path, name: value.name, previewKind: previewKind as PreviewKind | null };
}

function readSession(value: unknown): StoredSession {
  if (!isRecord(value)) return EMPTY_SESSION;
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.flatMap((t: unknown): StoredTab[] => {
        const base = readFile(t);
        return base && isRecord(t) && typeof t.pinned === "boolean"
          ? [{ ...base, pinned: t.pinned }]
          : [];
      })
    : [];
  const recent = Array.isArray(value.recent)
    ? value.recent.flatMap((r: unknown) => readFile(r) ?? [])
    : [];
  const active = typeof value.active === "string" ? value.active : null;
  return tabs.length === 0 && recent.length === 0 && active === null
    ? EMPTY_SESSION
    : { tabs, active, recent };
}

/** Toutes les sessions, dans l'ordre d'utilisation (la plus récente en dernier). */
function readAll(storage: Pick<Storage, "getItem">): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSIONS_KEY) ?? "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Session du dossier `root` ; absente, illisible ou stockage refusé : session vide. */
export function loadSession(storage: Pick<Storage, "getItem">, root: string): StoredSession {
  return readSession(readAll(storage)[root]);
}

/**
 * Enregistre la session de `root`, qui devient la plus récemment utilisée (les clés gardent
 * l'ordre d'insertion) ; au-delà de 20 dossiers, les plus anciens partent. Un échec est ignoré.
 */
export function saveSession(
  storage: Pick<Storage, "getItem" | "setItem">,
  root: string,
  session: StoredSession,
): void {
  try {
    const all = readAll(storage);
    const keys = Object.keys(all)
      .filter((key) => key !== root)
      .slice(-(MAX_SESSIONS - 1));
    const kept: Record<string, unknown> = {};
    for (const key of keys) kept[key] = all[key];
    kept[root] = session;
    storage.setItem(SESSIONS_KEY, JSON.stringify(kept));
  } catch {
    // Non enregistré : la session vaut jusqu'à la fermeture de l'app.
  }
}

/**
 * Onglets à rétablir : ceux dont le fichier existe encore (`exists`), dans l'ordre. L'actif
 * mémorisé s'il reste, sinon le premier onglet restant.
 */
export function restoreTabs(session: StoredSession, exists: (path: string) => boolean): TabsState {
  const tabs = session.tabs
    .filter((t) => exists(t.path))
    .map((t): Tab => ({
      id: crypto.randomUUID(),
      path: t.path,
      name: t.name,
      pinned: t.pinned,
      previewKind: t.previewKind,
    }));
  const active = tabs.some((t) => t.path === session.active)
    ? session.active
    : (tabs[0]?.path ?? null);
  return { tabs, active };
}

/** `file` passe en tête des récents (sans doublon), 20 au plus. */
export function touchRecent(recent: RecentFile[], file: RecentFile): RecentFile[] {
  if (recent[0]?.path === file.path) return recent;
  return [file, ...recent.filter((r) => r.path !== file.path)].slice(0, MAX_RECENT);
}

/** Les récents suivent le renommage de `from` (fichier ou dossier) en `to`. */
export function renameRecent(recent: RecentFile[], from: string, to: string): RecentFile[] {
  if (!recent.some((r) => isUnder(r.path, from))) return recent;
  return recent.map((r) => {
    if (!isUnder(r.path, from)) return r;
    const path = `${to}${r.path.slice(from.length)}`;
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { path, name, previewKind: previewKindOf(name) };
  });
}

/** Les récents perdent `path` et les fichiers sous le dossier `path` (corbeille). */
export function removeRecentUnder(recent: RecentFile[], path: string): RecentFile[] {
  const kept = recent.filter((r) => !isUnder(r.path, path));
  return kept.length === recent.length ? recent : kept;
}
