// Contexte des références d'issue d'un rendu Markdown (spec issues-github.md, lot 3) : présent,
// les `#123` du texte et les liens `…/issues/123` du même dépôt ouvrent l'issue en onglet.
import { createContext, useContext } from "react";

export type IssueRefs = {
  /** `owner/repo` du dépôt GitHub du dossier racine. */
  repoName: string;
  /** Ouvre l'issue `number` en onglet (une pull request s'ouvre dans le navigateur). */
  open: (number: number) => void;
};

export const IssueRefsContext = createContext<IssueRefs | null>(null);

/** Références actives dans le rendu en cours, `null` : `#123` reste du texte. */
export function useIssueRefs(): IssueRefs | null {
  return useContext(IssueRefsContext);
}
