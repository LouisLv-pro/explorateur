// Pages du panneau Terminal (docs/specs/terminal.md) : état pur, sans xterm ni IPC. Une page est
// un shell ; une seule est visible, les autres continuent de tourner.

export type TerminalPage = {
  /** Identifiant donné à Rust (`start_terminal`) : unique pendant la vie de la fenêtre. */
  id: number;
  /** Dossier de départ du shell. */
  cwd: string;
  /** Titre posé par le shell (OSC 0/2), `null` tant qu'il n'en a pas posé. */
  title: string | null;
  /** Sortie reçue pendant que la page était inactive. */
  activity: boolean;
  /** Titre fixé par l'app (page d'un serveur local) : passe avant celui du shell. */
  label?: string;
  /** Commande tapée par l'app une fois le shell lancé (Lancer un serveur local). */
  command?: string;
};

/** Page ouverte par l'app pour y lancer une commande, titrée par l'app. */
export type CommandPage = { label: string; command: string };

export type TerminalState = {
  pages: TerminalPage[];
  activeId: number | null;
  /** Panneau affiché. Masqué, les shells tournent toujours. */
  visible: boolean;
};

export const EMPTY_TERMINAL: TerminalState = { pages: [], activeId: null, visible: false };

/** Ajoute une page à la fin, l'active et affiche le panneau. */
export function openPage(
  state: TerminalState,
  id: number,
  cwd: string,
  run?: CommandPage,
): TerminalState {
  const page: TerminalPage = { id, cwd, title: null, activity: false, ...run };
  return { pages: [...state.pages, page], activeId: id, visible: true };
}

/** Retire une page ; la voisine de droite (sinon de gauche) devient active. Sans page : masqué. */
export function closePage(state: TerminalState, id: number): TerminalState {
  const index = state.pages.findIndex((p) => p.id === id);
  if (index === -1) return state;
  const pages = state.pages.filter((p) => p.id !== id);
  if (pages.length === 0) return { pages, activeId: null, visible: false };
  if (state.activeId !== id) return { ...state, pages };
  const next = pages[Math.min(index, pages.length - 1)]!;
  return activatePage({ ...state, pages }, next.id);
}

/** Active une page et efface son point d'activité. */
export function activatePage(state: TerminalState, id: number): TerminalState {
  if (!state.pages.some((p) => p.id === id)) return state;
  return {
    ...state,
    activeId: id,
    pages: state.pages.map((p) => (p.id === id && p.activity ? { ...p, activity: false } : p)),
  };
}

function step(state: TerminalState, delta: number): TerminalState {
  const count = state.pages.length;
  if (count === 0) return state;
  const index = state.pages.findIndex((p) => p.id === state.activeId);
  const target = state.pages[(index + delta + count) % count]!;
  return activatePage(state, target.id);
}

/** Page suivante, la première après la dernière. */
export const nextPage = (state: TerminalState) => step(state, 1);

/** Page précédente, la dernière avant la première. */
export const previousPage = (state: TerminalState) => step(state, -1);

export function showPanel(state: TerminalState): TerminalState {
  return state.visible ? state : { ...state, visible: true };
}

export function hidePanel(state: TerminalState): TerminalState {
  return state.visible ? { ...state, visible: false } : state;
}

/** Sortie dans la page `id` : point d'activité si elle n'est pas active. Même état sinon. */
export function markActivity(state: TerminalState, id: number): TerminalState {
  if (id === state.activeId) return state;
  const page = state.pages.find((p) => p.id === id);
  if (!page || page.activity) return state;
  return { ...state, pages: state.pages.map((p) => (p.id === id ? { ...p, activity: true } : p)) };
}

/** Titre posé par le shell ; vide, la page reprend le nom de son dossier. */
export function setPageTitle(state: TerminalState, id: number, title: string): TerminalState {
  const value = title.trim() === "" ? null : title;
  return {
    ...state,
    pages: state.pages.map((p) => (p.id === id && p.title !== value ? { ...p, title: value } : p)),
  };
}

/**
 * Titre affiché : celui fixé par l'app (serveur local), sinon celui du shell, sinon le nom du
 * dossier de départ (`/` pour la racine).
 */
export function pageLabel(page: TerminalPage): string {
  return page.label ?? page.title ?? page.cwd.split("/").filter(Boolean).at(-1) ?? "/";
}
