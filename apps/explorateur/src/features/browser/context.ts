import { createContext, useContext } from "react";
import type { AppError } from "@/bindings";
import type { BrowserTabsState } from "./tabs";

/** Navigateur intégré (docs/specs/navigateur.md) : onglets, états et gestes. */
export type BrowserView = {
  tabs: BrowserTabsState;
  /** Onglets dont la page est en cours de chargement. */
  loading: ReadonlySet<string>;
  /** Onglets dont la webview existe (Rust). */
  live: ReadonlySet<string>;
  maximized: boolean;
  /** Erreur sous le champ d'URL (adresse refusée…), traduite à l'affichage ; `null` sinon. */
  error: AppError | null;
  /** Incrémenté à chaque demande de focus du champ d'URL (ouverture, nouvel onglet vide). */
  focusSeq: number;
};

export type BrowserActions = {
  /** Affiche le panneau (⌃⇧B, bouton) ou le masque. */
  toggle: () => void;
  hide: () => void;
  /** Charge la saisie du champ d'URL dans l'onglet `id`. */
  navigate: (id: string, input: string) => void;
  newTab: () => void;
  /** Ouvre `url` dans un nouvel onglet actif et affiche le panneau (⌘clic du terminal). */
  openUrl: (url: string) => void;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
  back: (id: string) => void;
  forward: (id: string) => void;
  reload: (id: string) => void;
  toggleMaximized: () => void;
  clearError: () => void;
};

export const BrowserViewContext = createContext<BrowserView | null>(null);
export const BrowserActionsContext = createContext<BrowserActions | null>(null);

export function useBrowserView(): BrowserView {
  const value = useContext(BrowserViewContext);
  if (!value) throw new Error("useBrowserView hors de <BrowserProvider>");
  return value;
}

export function useBrowserActions(): BrowserActions {
  const value = useContext(BrowserActionsContext);
  if (!value) throw new Error("useBrowserActions hors de <BrowserProvider>");
  return value;
}
