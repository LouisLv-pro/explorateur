// Dialogue « Nouvelle issue » partagé (spec issues-github.md, lots 2 et 3) : le bouton de la vue
// Issues et « Créer une issue depuis la sélection » (menu Actions, menu d'onglet) l'ouvrent par
// le même contexte. Monté au-dessus de l'arborescence et de l'aperçu, hors de leurs `<Activity>`.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "@/features/workspace/context";
import { appendToIssueDraft } from "./draft";
import { NewIssueDialog } from "./NewIssueDialog";

export type NewIssueRequest = {
  /** `owner/repo` : clé du brouillon. */
  repoName: string;
  /** Texte ajouté à la fin du corps du brouillon (créé s'il n'existe pas), jamais à sa place. */
  append?: string;
  /** Avertissement affiché en haut du formulaire. */
  notice?: string | null;
};

type Opener = (request: NewIssueRequest) => void;

const ComposerContext = createContext<Opener | null>(null);

/** Ouvre le dialogue de création, pré-rempli si besoin. */
export function useNewIssue(): Opener {
  const opener = useContext(ComposerContext);
  if (!opener) throw new Error("useNewIssue hors de <IssueComposerProvider>");
  return opener;
}

type Open = { root: string; repoName: string; notice: string | null; open: boolean };

function writeAppend(repoName: string, text: string) {
  try {
    appendToIssueDraft(localStorage, repoName, text);
  } catch {
    // Brouillon non gardé : le dialogue s'ouvre quand même, sans le texte.
  }
}

export function IssueComposerProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const rootPath = root?.path ?? null;
  const [state, setState] = useState<Open | null>(null);

  const openNewIssue = useCallback<Opener>(
    ({ repoName, append, notice = null }) => {
      if (rootPath === null) return;
      if (append !== undefined) writeAppend(repoName, append);
      setState({ root: rootPath, repoName, notice, open: true });
    },
    [rootPath],
  );

  const onOpenChange = useCallback(
    (open: boolean) => setState((current) => current && { ...current, open }),
    [],
  );
  const value = useMemo(() => openNewIssue, [openNewIssue]);

  return (
    <ComposerContext value={value}>
      {children}
      {state !== null && state.root === rootPath && (
        <NewIssueDialog
          open={state.open}
          onOpenChange={onOpenChange}
          root={state.root}
          repoName={state.repoName}
          notice={state.notice}
        />
      )}
    </ComposerContext>
  );
}
