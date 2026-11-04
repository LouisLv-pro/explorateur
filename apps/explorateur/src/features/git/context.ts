import { createContext, useContext } from "react";
import type { RemoteState } from "@/bindings";
import { NO_MARKS, type MarkIndex } from "./marks";
import type { NetworkGesture } from "./remote";

/** Volet Modifications : affiché ou non, demandes de focus et gestes. */
export type GitPanelState = {
  open: boolean;
  /** Incrémenté à chaque demande de focus du volet (⌃⇧G, bouton). */
  focusSeq: number;
  /**
   * Incrémenté à chaque modification du brouillon de commit venue de l'extérieur (« Lier au
   * commit ») : le champ du message relit le brouillon et prend le focus.
   */
  messageSeq: number;
  /** Ajoute `Fixes #N` au brouillon de commit, affiche le volet et met le focus dans le champ. */
  linkIssue: (issue: number) => void;
  /** Affiche le volet (et lui donne le focus) ou le masque (focus rendu à l'aperçu). */
  toggle: () => void;
  hide: () => void;
};

export const GitContext = createContext<GitPanelState | null>(null);

/** Repères git du dossier racine (lot 3), lus une fois pour l'arborescence, les onglets, l'éditeur. */
export type GitMarks = {
  /** Le dossier racine est dans un dépôt (sinon aucune requête de repère). */
  inRepo: boolean;
  marks: MarkIndex;
};

export const GitMarksContext = createContext<GitMarks>({ inRepo: false, marks: NO_MARKS });

export function useGitMarksContext(): GitMarks {
  return useContext(GitMarksContext);
}

/** Branche distante (spec git-distant.md) : état lu sans réseau et gestes réseau. */
export type RemoteSync = {
  /** `undefined` : pas encore lu, ou hors dépôt. */
  state: RemoteState | undefined;
  /** Geste réseau en cours (manuel ou automatique), un seul à la fois. */
  busy: NetworkGesture | null;
  /** Dernière récupération réussie (ms depuis 1970), `null` si aucune depuis l'ouverture. */
  lastFetch: number | null;
  /** Récupération automatique échouée : « Récupération impossible : … » (infobulle). */
  autoError: string | null;
  /** Erreur d'un geste manuel, affichée sous l'en-tête du volet. */
  error: string | null;
  dismissError: () => void;
  fetch: () => void;
  /** Pousse ou publie ; vrai si réussi (« Committer et pousser » : l'erreur reste affichée). */
  push: () => Promise<boolean>;
  pull: () => void;
};

export const NO_REMOTE: RemoteSync = {
  state: undefined,
  busy: null,
  lastFetch: null,
  autoError: null,
  error: null,
  dismissError: () => {},
  fetch: () => {},
  push: () => Promise.resolve(false),
  pull: () => {},
};

export const RemoteContext = createContext<RemoteSync>(NO_REMOTE);

export function useRemoteSync(): RemoteSync {
  return useContext(RemoteContext);
}

export function useGitPanel(): GitPanelState {
  const value = useContext(GitContext);
  if (!value) throw new Error("useGitPanel hors de <GitProvider>");
  return value;
}

/** Vrai si `element` est dans le volet Modifications. */
export function isInGitPanel(element: EventTarget | null): boolean {
  return element instanceof Element && element.closest("[data-git-panel]") !== null;
}
