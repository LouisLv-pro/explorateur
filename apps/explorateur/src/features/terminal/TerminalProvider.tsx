// État du panneau Terminal (docs/specs/terminal.md). Au-dessus de l'accueil et du dossier
// racine : changer de dossier ou revenir à l'accueil ne ferme aucune page.
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { terminalAction } from "@/features/shortcuts/shortcuts";
import { useWorkspace } from "@/features/workspace/context";
import { parentPath } from "@/lib/paths";
import { onTerminalExited, runningCommandOf, writeTerminal } from "./api";
import { stopPageConfirmation } from "./confirm";
import { StopDialog } from "./StopDialog";
import {
  TerminalActionsContext,
  TerminalLayoutContext,
  TerminalViewContext,
  isInTerminal,
  type TerminalActions,
  type TerminalLayout,
  type TerminalView,
} from "./context";
import {
  EMPTY_TERMINAL,
  activatePage,
  closePage as closePageOf,
  hidePanel,
  markActivity,
  nextPage,
  openPage,
  previousPage,
  setPageTitle,
  showPanel,
  type TerminalState,
} from "./pages";

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Identifiant de page donné à Rust, unique pendant la vie de la fenêtre. */
let lastPageId = 0;

/** Rend le focus à l'aperçu (zone `data-preview`). */
function focusPreview() {
  document.querySelector<HTMLElement>("[data-preview]")?.focus({ preventScroll: true });
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const [state, setState] = useState<TerminalState>(EMPTY_TERMINAL);
  const [maximized, setMaximized] = useState(false);
  const [focusSeq, setFocusSeq] = useState(0);
  /** Fermeture d'une page dont un processus tourne, en attente de confirmation. */
  const [stopRequest, setStopRequest] = useState<{ id: number; command: string } | null>(null);
  // Lus par les gestes (objet stable) : tenus à jour après chaque rendu.
  const rootRef = useRef(root);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    rootRef.current = root;
    stateRef.current = state;
  });

  const actions = useMemo<TerminalActions>(() => {
    const requestFocus = () => setFocusSeq((n) => n + 1);
    const newPage = (cwd?: string) => {
      const dir = cwd ?? rootRef.current?.path;
      if (dir === undefined) return;
      lastPageId += 1;
      const id = lastPageId;
      setState((s) => openPage(s, id, dir));
      requestFocus();
    };
    const closePage = (id: number) => {
      const wasLast = stateRef.current.pages.length === 1;
      setState((s) => closePageOf(s, id));
      if (wasLast) focusPreview();
      else requestFocus();
    };
    const hide = () => {
      if (!stateRef.current.visible) return;
      setState(hidePanel);
      focusPreview();
    };
    return {
      newPage,
      hide,
      toggle: () => {
        const s = stateRef.current;
        if (s.visible) hide();
        else if (s.pages.length === 0) newPage();
        else {
          setState(showPanel);
          requestFocus();
        }
      },
      openIn: (path, isDir) => newPage(isDir ? path : parentPath(path)),
      closePage,
      requestClose: (id) => {
        void runningCommandOf(id).then((command) => {
          if (command === null) closePage(id);
          else setStopRequest({ id, command });
        });
      },
      activate: (id) => {
        setState((s) => activatePage(s, id));
        requestFocus();
      },
      toggleMaximized: () => {
        setMaximized((m) => !m);
        requestFocus();
      },
      reportActivity: (id) => setState((s) => markActivity(s, id)),
      reportTitle: (id, title) => setState((s) => setPageTitle(s, id, title)),
      runCommand: (cwd, run) => {
        lastPageId += 1;
        const id = lastPageId;
        // Sans `requestFocus` : la page s'affiche, le focus reste où il est.
        setState((s) => openPage(s, id, cwd, run));
        return id;
      },
      rerunCommand: async (id, command) => {
        if (!stateRef.current.pages.some((p) => p.id === id)) return false;
        if ((await runningCommandOf(id)) !== null) return false;
        if (!stateRef.current.pages.some((p) => p.id === id)) return false;
        setState((s) => showPanel(activatePage(s, id)));
        writeTerminal(id, `${command}\r`);
        return true;
      },
      reveal: (id) => {
        setState((s) => showPanel(activatePage(s, id)));
        requestFocus();
      },
      write: (id, data) => writeTerminal(id, data),
    };
  }, []);

  // Le shell s'est terminé de lui-même : sa page se ferme (la dernière masque le panneau).
  useEffect(() => onTerminalExited((id) => actions.closePage(id)), [actions]);

  // ⌘W est une entrée du menu natif (`close-tab`) : focus dans le terminal, il ferme la page
  // active ; ailleurs, `WorkspaceProvider` ferme l'onglet de fichier.
  useEffect(() => {
    const unlisten = listen("close-tab", () => {
      const { activeId, visible } = stateRef.current;
      if (visible && activeId !== null && isInTerminal(document.activeElement)) {
        actions.requestClose(activeId);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, [actions]);

  // ⌃` ⌘J ⇧⌃` partout (dossier ouvert) ; ⇧⌘[ ⇧⌘] ⇧⌘↵ ⌘K avec le focus dans le terminal.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || rootRef.current === null) return;
    if (document.querySelector(OVERLAY) !== null) return;
    const action = terminalAction(event, { inTerminal: isInTerminal(event.target) });
    if (action === null) return;
    event.preventDefault();
    switch (action) {
      case "terminal-toggle":
      case "terminal-toggle-alt":
        actions.toggle();
        break;
      case "terminal-new":
        actions.newPage();
        break;
      case "terminal-previous":
        setState(previousPage);
        setFocusSeq((n) => n + 1);
        break;
      case "terminal-next":
        setState(nextPage);
        setFocusSeq((n) => n + 1);
        break;
      case "terminal-maximize":
        actions.toggleMaximized();
        break;
      case "terminal-clear":
        // Pris avant par la page qui a le focus (elle tient son xterm) : voir `TerminalPage`.
        break;
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const view = useMemo<TerminalView>(
    () => ({ ...state, maximized, focusSeq }),
    [state, maximized, focusSeq],
  );

  const visible = state.visible;
  const layout = useMemo<TerminalLayout>(() => ({ visible, maximized }), [visible, maximized]);

  return (
    <TerminalActionsContext value={actions}>
      <TerminalLayoutContext value={layout}>
        <TerminalViewContext value={view}>{children}</TerminalViewContext>
      </TerminalLayoutContext>
      {stopRequest && (
        <StopDialog
          text={stopPageConfirmation(stopRequest.command)}
          onConfirm={() => {
            setStopRequest(null);
            actions.closePage(stopRequest.id);
          }}
          onCancel={() => setStopRequest(null)}
          restoreFocus={() => setFocusSeq((n) => n + 1)}
        />
      )}
    </TerminalActionsContext>
  );
}
