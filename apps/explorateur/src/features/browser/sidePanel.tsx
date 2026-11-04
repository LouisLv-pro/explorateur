// Colonne de droite : volet Modifications ou navigateur, jamais les deux (exclusivité de
// `panel.ts`). L'état affiché est gardé dans le localStorage.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadSidePanel,
  saveSidePanel,
  showSidePanel,
  toggleSidePanel,
  type SidePanel,
} from "./panel";

type Panels = "git" | "browser";

type SidePanelState = {
  panel: SidePanel;
  /** Affiche `panel` (masque l'autre) ou le masque s'il est déjà affiché. */
  toggle: (panel: Panels) => void;
  /** Affiche `panel` sans jamais le masquer. */
  show: (panel: Panels) => void;
  /** Masque `panel` s'il est affiché. */
  hide: (panel: Panels) => void;
};

const SidePanelContext = createContext<SidePanelState | null>(null);

function readPanel(): SidePanel {
  try {
    return loadSidePanel(localStorage);
  } catch {
    return null;
  }
}

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<SidePanel>(readPanel);
  const ref = useRef(panel);

  const change = useCallback((next: SidePanel) => {
    if (next === ref.current) return;
    ref.current = next;
    setPanel(next);
    try {
      saveSidePanel(localStorage, next);
    } catch {
      // Non enregistré : vaut pour la session.
    }
  }, []);

  // Gestes stables : les écouteurs des fournisseurs ne sont pas réabonnés à chaque changement.
  const gestures = useMemo(
    () => ({
      toggle: (p: Panels) => change(toggleSidePanel(ref.current, p)),
      show: (p: Panels) => change(showSidePanel(ref.current, p)),
      hide: (p: Panels) => {
        if (ref.current === p) change(null);
      },
    }),
    [change],
  );
  const value = useMemo<SidePanelState>(() => ({ panel, ...gestures }), [panel, gestures]);
  return <SidePanelContext value={value}>{children}</SidePanelContext>;
}

export function useSidePanel(): SidePanelState {
  const value = useContext(SidePanelContext);
  if (!value) throw new Error("useSidePanel hors de <SidePanelProvider>");
  return value;
}
