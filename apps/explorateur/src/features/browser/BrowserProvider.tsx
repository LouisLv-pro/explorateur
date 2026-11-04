// Navigateur intégré (docs/specs/navigateur.md, décision 0011) : le front tient la liste des
// onglets (`tabs.ts`), Rust tient les webviews. Les gestes passent par les commandes
// `browser_*` ; l'URL, le titre et le chargement reviennent par événements. La webview d'un
// onglet n'est créée qu'à son premier affichage (onglets relus au lancement : pas de rechargement
// de toutes les pages d'un coup).
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
import { type AppError, commands, events } from "@/bindings";
import { browserAction } from "@/features/shortcuts/shortcuts";
import { isAppError } from "@/lib/ipc";
import {
  BrowserActionsContext,
  BrowserViewContext,
  type BrowserActions,
  type BrowserView,
} from "./context";
import { isInBrowserPage } from "./focus";
import { useSidePanel } from "./sidePanel";
import {
  activateBrowserTab,
  closeBrowserTab,
  loadBrowserTabs,
  openBrowserTab,
  saveBrowserTabs,
  type BrowserTabsState,
} from "./tabs";

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

let lastTabId = 0;
const newTabId = () => `b${++lastTabId}`;

function readTabs(): BrowserTabsState {
  try {
    return loadBrowserTabs(localStorage, newTabId);
  } catch {
    return loadBrowserTabs({ getItem: () => null }, newTabId);
  }
}

/** Rend le focus à l'aperçu (zone `data-preview`). */
function focusPreview() {
  document.querySelector<HTMLElement>("[data-preview]")?.focus({ preventScroll: true });
}

const withTab =
  (id: string, patch: { url?: string; title?: string }) =>
  (state: BrowserTabsState): BrowserTabsState => ({
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
  });

export function BrowserProvider({ children }: { children: ReactNode }) {
  const side = useSidePanel();
  const { show, hide } = side;
  const [tabs, setTabs] = useState(readTabs);
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [live, setLive] = useState<ReadonlySet<string>>(new Set());
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);

  const tabsRef = useRef(tabs);
  const liveRef = useRef(new Set<string>());
  /** Onglets dont le premier chargement est lancé (ou fait). */
  const startedRef = useRef(new Set<string>());
  const panelRef = useRef(side.panel);
  useLayoutEffect(() => {
    panelRef.current = side.panel;
  });

  // Onglets et onglet actif gardés pour la prochaine ouverture.
  useEffect(() => {
    try {
      saveBrowserTabs(localStorage, tabs);
    } catch {
      // Non enregistrés : valent pour la session.
    }
  }, [tabs]);

  const actions = useMemo<BrowserActions>(() => {
    const update = (change: (state: BrowserTabsState) => BrowserTabsState) => {
      tabsRef.current = change(tabsRef.current);
      setTabs(tabsRef.current);
    };
    const syncLive = () => setLive(new Set(liveRef.current));
    const withFocus = <T,>(run: () => T): T => {
      const result = run();
      setFocusSeq((n) => n + 1);
      return result;
    };

    const navigate = (id: string, input: string) => {
      startedRef.current.add(id);
      void commands.browserNavigate(id, input).then((result) => {
        if (!tabsRef.current.tabs.some((tab) => tab.id === id)) {
          // Onglet fermé pendant le chargement : sa webview n'a plus de raison d'être.
          if (result.status === "ok") void commands.browserClose(id);
          return;
        }
        if (result.status === "ok") {
          liveRef.current.add(id);
          syncLive();
          setError(null);
          update(withTab(id, { url: result.data }));
        } else {
          if (!liveRef.current.has(id)) startedRef.current.delete(id);
          setError(
            isAppError(result.error)
              ? result.error
              : { kind: "Browser", message: String(result.error) },
          );
        }
      });
    };

    const closeTab = (id: string) => {
      update((state) => closeBrowserTab(state, id, newTabId()));
      startedRef.current.delete(id);
      if (liveRef.current.delete(id)) {
        syncLive();
        void commands.browserClose(id);
      }
      setError(null);
    };

    const call = (run: (id: string) => Promise<unknown>) => (id: string) => void run(id);
    return {
      // Affiche le panneau (champ d'URL au focus) ou le masque (focus rendu à l'aperçu).
      toggle: () => {
        if (panelRef.current === "browser") {
          hide("browser");
          focusPreview();
        } else {
          show("browser");
          setFocusSeq((n) => n + 1);
        }
      },
      hide: () => {
        hide("browser");
        focusPreview();
      },
      navigate,
      newTab: () => withFocus(() => update((state) => openBrowserTab(state, newTabId()))),
      openUrl: (url) => {
        show("browser");
        update((state) => openBrowserTab(state, newTabId(), url));
        setError(null);
      },
      activate: (id) => {
        update((state) => activateBrowserTab(state, id));
        setError(null);
      },
      closeTab,
      back: call(commands.browserBack),
      forward: call(commands.browserForward),
      reload: call(commands.browserReload),
      toggleMaximized: () => setMaximized((value) => !value),
      clearError: () => setError(null),
    };
  }, [show, hide]);

  // Premier affichage d'un onglet qui a une adresse : sa webview est créée.
  const active = tabs.tabs.find((tab) => tab.id === tabs.active);
  useEffect(() => {
    if (side.panel !== "browser" || !active || active.url === "") return;
    if (startedRef.current.has(active.id)) return;
    actions.navigate(active.id, active.url);
  }, [side.panel, active, actions]);

  // Événements de Rust : adresse, titre, chargement, demande de nouvelle fenêtre.
  useEffect(() => {
    const unlisten = [
      events.browserNavigated.listen(({ payload }) => {
        const exists = tabsRef.current.tabs.some((tab) => tab.id === payload.id);
        if (exists) {
          tabsRef.current = withTab(payload.id, { url: payload.url })(tabsRef.current);
          setTabs(tabsRef.current);
        }
      }),
      events.browserTitleChanged.listen(({ payload }) => {
        tabsRef.current = withTab(payload.id, { title: payload.title })(tabsRef.current);
        setTabs(tabsRef.current);
      }),
      events.browserLoading.listen(({ payload }) => {
        setLoading((set) => {
          const next = new Set(set);
          if (payload.loading) next.add(payload.id);
          else next.delete(payload.id);
          return next;
        });
      }),
      events.browserNewTab.listen(({ payload }) => actions.openUrl(payload.url)),
    ];
    return () => {
      for (const off of unlisten) void off.then((stop) => stop());
    };
  }, [actions]);

  // ⌘W est une entrée du menu natif (`close-tab`) : focus dans la page, il ferme l'onglet du
  // navigateur ; `WorkspaceProvider` laisse alors l'onglet de fichier tranquille.
  useEffect(() => {
    const off = listen("close-tab", () => {
      if (panelRef.current === "browser" && isInBrowserPage()) {
        actions.closeTab(tabsRef.current.active);
      }
    });
    return () => void off.then((stop) => stop());
  }, [actions]);

  // ⌃⇧B partout, avec ou sans dossier (le terminal le laisse passer : `terminalTakesKey`).
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector(OVERLAY) !== null) return;
    if (browserAction(event) !== "browser-toggle") return;
    event.preventDefault();
    actions.toggle();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const view = useMemo<BrowserView>(
    () => ({ tabs, loading, live, maximized, error, focusSeq }),
    [tabs, loading, live, maximized, error, focusSeq],
  );
  return (
    <BrowserActionsContext value={actions}>
      <BrowserViewContext value={view}>{children}</BrowserViewContext>
    </BrowserActionsContext>
  );
}
