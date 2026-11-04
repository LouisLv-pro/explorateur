import { createContext, use, useContext } from "react";
import type { Entry, IssueState, RootFolder } from "@/bindings";
import type { RecentFile } from "@/features/session/session";
import type { Tab } from "@/features/tabs/tabs";

/** Options d'ouverture d'un fichier : onglet épinglé, ligne à montrer. */
export type OpenFileOptions = { pin?: boolean; line?: number };

/** Entrée à mettre à la corbeille. */
export type TrashTarget = { path: string; name: string; isDir: boolean };

/**
 * État de session partagé par les panneaux : dossier racine, onglets, éléments masqués.
 * Les données venues de Rust (récents, listes de dossiers) restent dans TanStack Query.
 */
export type Workspace = {
  /** `null` : écran d'accueil. */
  root: RootFolder | null;
  /** Onglets ouverts, de gauche à droite. */
  tabs: Tab[];
  /** Onglet actif, `null` sans onglet. */
  activeTab: Tab | null;
  /** Fichier de l'onglet actif ; `null` sur l'aperçu d'un serveur ou une issue. */
  currentFile: Entry | null;
  /** Ouvre un onglet provisoire (ou épinglé avec `pin`) et l'active. */
  openFile: (entry: Entry, options?: OpenFileOptions) => void;
  /** Ouvre (ou active) l'onglet d'aperçu du serveur local `key`, titré `name`. */
  openServerTab: (key: string, name: string) => void;
  /**
   * Ouvre (ou active) l'onglet de l'issue `number` du dépôt `repo`, titré `name` : provisoire,
   * ou épinglé avec `pin` (double clic, ↵).
   */
  openIssueTab: (
    repo: string,
    number: number,
    name: string,
    state: IssueState,
    options?: { pin?: boolean },
  ) => void;
  pinTab: (path: string) => void;
  activateTab: (path: string) => void;
  closeTab: (path: string) => void;
  closeOtherTabs: (path: string) => void;
  /** Les onglets de `from` (ou sous le dossier `from`) suivent son renommage en `to`. */
  renameTabs: (from: string, to: string) => void;
  /** Demande la mise à la corbeille de `target` : la boîte de confirmation s'ouvre. */
  requestTrash: (target: TrashTarget) => void;
  /** Onglet suivant (`1`) ou précédent (`-1`). */
  cycleTab: (direction: 1 | -1) => void;
  showHidden: boolean;
  toggleHidden: () => void;
  /** Ouvre `path` comme dossier racine ; une erreur s'affiche dans la bannière. */
  openFolder: (path: string) => Promise<void>;
  /** Sélecteur natif de dossier (⌘O). */
  pickFolder: () => Promise<void>;
  /** Retour à l'écran d'accueil. */
  closeFolder: () => void;
  /** Bannière d'erreur en bas de la fenêtre. */
  showError: (message: string) => void;
  /** Message bref (1,5 s) en bas de la fenêtre. */
  notify: (message: string) => void;
};

/** Actions qui ne changent jamais d'identité : leurs lecteurs ne suivent pas l'état. */
export type WorkspaceActions = Pick<
  Workspace,
  | "openFile"
  | "openServerTab"
  | "openIssueTab"
  | "pinTab"
  | "activateTab"
  | "renameTabs"
  | "requestTrash"
  | "cycleTab"
  | "toggleHidden"
  | "showError"
  | "notify"
>;

export const WorkspaceContext = createContext<Workspace | null>(null);
export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/**
 * Fichiers récemment activés du dossier racine affiché, du plus récent au plus ancien (⌘P,
 * spec continuite.md). Contexte à part : les tests qui fournissent un faux espace de travail
 * n'ont pas à le connaître (vide par défaut).
 */
export const RecentFilesContext = createContext<readonly RecentFile[]>([]);

export function useRecentFiles(): readonly RecentFile[] {
  return useContext(RecentFilesContext);
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace hors de <WorkspaceProvider>");
  return workspace;
}

/**
 * Actions stables de l'espace de travail. Un composant qui n'a besoin que d'elles ne se
 * redessine pas à chaque changement d'onglet (ouvrir un fichier, par exemple).
 */
export function useWorkspaceActions(): WorkspaceActions {
  // `use` se lit sous condition : sans contexte d'actions (tests qui ne fournissent que
  // l'espace de travail), on se rabat sur lui, qui les contient aussi.
  const actions = use(WorkspaceActionsContext);
  if (actions) return actions;
  const workspace = use(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspaceActions hors de <WorkspaceProvider>");
  return workspace;
}
