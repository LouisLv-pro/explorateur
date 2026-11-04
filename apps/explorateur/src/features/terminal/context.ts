import { createContext, useContext } from "react";
import type { CommandPage, TerminalState } from "./pages";

/** État affiché du panneau Terminal. Change souvent (titres, points d'activité). */
export type TerminalView = TerminalState & {
  /** Le panneau couvre toute la zone d'aperçu. Gardé quand le panneau est masqué. */
  maximized: boolean;
  /** Incrémenté à chaque demande de focus pour la page active (affichage, nouvelle page…). */
  focusSeq: number;
};

/** Gestes du panneau : objet stable, sans rendu quand l'état change. */
export type TerminalActions = {
  /** Affiche (en créant une page s'il n'y en a pas) ou masque le panneau. */
  toggle: () => void;
  hide: () => void;
  /** Nouvelle page dans `cwd` (le dossier racine par défaut), panneau affiché. */
  newPage: (cwd?: string) => void;
  /** « Ouvrir dans le terminal » : le dossier, ou le dossier parent d'un fichier. */
  openIn: (path: string, isDir: boolean) => void;
  /** Ferme sans question (le shell s'est terminé, confirmation donnée). */
  closePage: (id: number) => void;
  /** Bouton fermer et ⌘W : confirmation si un processus tourne dans la page. */
  requestClose: (id: number) => void;
  activate: (id: number) => void;
  toggleMaximized: () => void;
  /** Sortie reçue par une page inactive (point d'activité). */
  reportActivity: (id: number) => void;
  /** Titre posé par le shell (OSC 0/2). */
  reportTitle: (id: number, title: string) => void;
  /**
   * Nouvelle page dans `cwd`, titrée `run.label`, où `run.command` est tapée suivie de `↵` une
   * fois le shell lancé. Le panneau s'affiche sans prendre le focus. Renvoie l'identifiant.
   */
  runCommand: (cwd: string, run: CommandPage) => number;
  /**
   * Retape `command` suivie de `↵` dans la page `id` si elle est ouverte et revenue au prompt
   * (aucun processus en cours) ; le panneau s'affiche sur elle sans prendre le focus. Renvoie
   * `false` sinon (page fermée ou occupée) : il faut alors une nouvelle page.
   */
  rerunCommand: (id: number, command: string) => Promise<boolean>;
  /** Affiche le panneau sur la page `id` et lui donne le focus. */
  reveal: (id: number) => void;
  /** Écrit `data` dans la page `id` comme une saisie (`⌃C` : `"\x03"`). */
  write: (id: number, data: string) => void;
};

/** Disposition seule (bouton, aperçu masqué quand agrandi) : ne change pas à chaque sortie. */
export type TerminalLayout = { visible: boolean; maximized: boolean };

export const TerminalViewContext = createContext<TerminalView | null>(null);
export const TerminalLayoutContext = createContext<TerminalLayout | null>(null);

export function useTerminalLayout(): TerminalLayout {
  const value = useContext(TerminalLayoutContext);
  if (!value) throw new Error("useTerminalLayout hors de <TerminalProvider>");
  return value;
}
export const TerminalActionsContext = createContext<TerminalActions | null>(null);

export function useTerminalView(): TerminalView {
  const value = useContext(TerminalViewContext);
  if (!value) throw new Error("useTerminalView hors de <TerminalProvider>");
  return value;
}

export function useTerminalActions(): TerminalActions {
  const value = useContext(TerminalActionsContext);
  if (!value) throw new Error("useTerminalActions hors de <TerminalProvider>");
  return value;
}

/** Vrai si `element` est dans le panneau Terminal (focus dans un terminal ou son en-tête). */
export function isInTerminal(element: EventTarget | null): boolean {
  return element instanceof Element && element.closest("[data-terminal-panel]") !== null;
}
