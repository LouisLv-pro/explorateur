// Volet Modifications (docs/specs/git.md) : affiché ou masqué (gardé dans le localStorage),
// ⌃⇧G, et relecture de l'état git à chaque changement disque et au retour du focus.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events, type GitSnapshot } from "@/bindings";
import { gitAction } from "@/features/shortcuts/shortcuts";
import { useWorkspace } from "@/features/workspace/context";
import { gitDiffRootKey, gitStatusKey, useGitMarks } from "./api";
import { appendFixes, loadDraft, saveDraft } from "./commit";
import { GitContext, GitMarksContext, RemoteContext, type GitPanelState } from "./context";
import { shouldRefreshGit } from "./refresh";
import { useRemoteGestures } from "./remoteSync";
import { useSidePanel } from "@/features/browser/sidePanel";

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Rend le focus à l'aperçu (zone `data-preview`). */
function focusPreview() {
  document.querySelector<HTMLElement>("[data-preview]")?.focus({ preventScroll: true });
}

export function GitProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const queryClient = useQueryClient();
  // Affiché ou non : état commun de la colonne de droite, exclusif avec le navigateur.
  const side = useSidePanel();
  const open = side.panel === "git";
  const [focusSeq, setFocusSeq] = useState(0);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });

  const { show: showPanel, hide: hidePanel } = side;
  const actions = useMemo(() => {
    const hide = () => {
      if (!openRef.current) return;
      hidePanel("git");
      focusPreview();
    };
    const toggle = () => {
      if (openRef.current) {
        hide();
        return;
      }
      showPanel("git");
      setFocusSeq((n) => n + 1);
    };
    return { hide, toggle };
  }, [showPanel, hidePanel]);

  // ⌃⇧G partout, dossier ouvert (le terminal le laisse passer : `terminalTakesKey`).
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || root === null) return;
    if (document.querySelector(OVERLAY) !== null) return;
    if (gitAction(event, { inPanel: false }) !== "git-toggle") return;
    event.preventDefault();
    actions.toggle();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Relecture : changement disque sous le dossier racine (le watcher ignore `.git`, d'où aussi
  // le sondage du volet affiché) et retour du focus sur la fenêtre.
  const rootPath = root?.path ?? null;
  useEffect(() => {
    if (rootPath === null) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: gitStatusKey(rootPath) });
      void queryClient.invalidateQueries({ queryKey: gitDiffRootKey(rootPath) });
    };
    // Changement disque : relit seulement si le lot touche un chemin ni ignoré ni sous un
    // dossier non suivi replié (écritures d'un build, d'un cache), d'après le dernier statut.
    const unlisten = events.diskChanged.listen((event) => {
      const snapshot = queryClient.getQueryData<GitSnapshot>(gitStatusKey(rootPath));
      if (shouldRefreshGit(event.payload.files, rootPath, snapshot)) refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      void unlisten.then((off) => off());
    };
  }, [queryClient, rootPath]);

  // « Lier au commit » : le brouillon du message est dans le `localStorage` (le champ le garde à
  // chaque frappe) ; le champ le relit sur `messageSeq`.
  const [messageSeq, setMessageSeq] = useState(0);
  const linkIssue = useCallback(
    (issue: number) => {
      if (rootPath === null) return;
      try {
        saveDraft(localStorage, rootPath, appendFixes(loadDraft(localStorage, rootPath), issue));
      } catch {
        // Brouillon non gardé : le champ n'a rien à relire.
      }
      showPanel("git");
      setMessageSeq((n) => n + 1);
    },
    [rootPath, showPanel],
  );
  const value = useMemo<GitPanelState>(
    () => ({ open, focusSeq, messageSeq, linkIssue, ...actions }),
    [open, focusSeq, messageSeq, linkIssue, actions],
  );
  // Repères (lot 3) : une seule requête, lue ici pour l'arborescence, les onglets, l'éditeur.
  const marks = useGitMarks(rootPath, open);
  // Branche distante (spec git-distant.md) : état, gestes réseau et récupération automatique.
  const remote = useRemoteGestures(rootPath, open);
  return (
    <GitContext value={value}>
      <GitMarksContext value={marks}>
        <RemoteContext value={remote}>{children}</RemoteContext>
      </GitMarksContext>
    </GitContext>
  );
}
