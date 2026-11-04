// Panneau Terminal (docs/specs/terminal.md) : bas de la zone d'aperçu, pages en onglets
// compacts, poignée de hauteur, agrandir et masquer. Toujours monté (même sur l'accueil) :
// masqué, ses shells tournent et ses pages gardent leur contenu.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Maximize2, Minimize2, Plus, SquareTerminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortcutHint, type ShortcutAction } from "@/features/shortcuts/shortcuts";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { useRunningTerminals } from "./api";
import { useTerminalActions, useTerminalLayout, useTerminalView } from "./context";
import { defaultHeight, loadHeight, panelHeight, saveHeight } from "./height";
import { pageLabel, type TerminalPage as Page } from "./pages";
import { TerminalPage } from "./TerminalPage";

function readStoredHeight(): number | null {
  try {
    return loadHeight(localStorage);
  } catch {
    return null;
  }
}

function storeHeight(height: number) {
  try {
    saveHeight(localStorage, height);
  } catch {
    // Non enregistrée : elle vaut pour la session.
  }
}

/** Libellé d'infobulle avec son raccourci : « Nouveau terminal (⇧⌃`) ». */
const withHint = (label: string, action: ShortcutAction) =>
  i18n.t("terminal:withShortcut", { label, shortcut: shortcutHint(action) });

export function TerminalPanel({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation("terminal");
  const view = useTerminalView();
  const { newPage, hide, toggleMaximized } = useTerminalActions();
  const panelRef = useRef<HTMLElement>(null);
  const [stored, setStored] = useState(readStoredHeight);
  // Hauteur de la zone d'aperçu (le parent du panneau), pour borner celle du panneau.
  const [area, setArea] = useState(0);

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => setArea(parent.clientHeight));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const newLabel = withHint(t("newTerminal"), "terminal-new");
  const maximizeLabel = withHint(
    view.maximized ? t("restore") : t("maximize"),
    "terminal-maximize",
  );
  const hideLabel = withHint(t("hide"), "terminal-toggle");
  const shown = view.visible && !disabled;
  const height = panelHeight(stored, area);
  // Sondé seulement panneau affiché : masqué, l'icône ne se voit pas.
  const running = useRunningTerminals(shown && view.pages.length > 0);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = height;
    let last = startHeight;
    const onMove = (move: globalThis.PointerEvent) => {
      last = startHeight + (startY - move.clientY);
      setStored(last);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      storeHeight(panelHeight(last, area));
      setStored(panelHeight(last, area));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function resetHeight() {
    const value = defaultHeight(area);
    setStored(value);
    storeHeight(value);
  }

  return (
    <section
      ref={panelRef}
      data-terminal-panel
      aria-label={t("name")}
      className={cn(
        "relative flex shrink-0 flex-col border-t border-hairline bg-canvas",
        view.maximized && "min-h-0 flex-1 border-t-0",
        !shown && "hidden",
      )}
      style={view.maximized ? undefined : { height }}
    >
      {!view.maximized && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("heightHandle")}
          aria-valuenow={height}
          title={t("heightHint")}
          onPointerDown={onPointerDown}
          onDoubleClick={resetHeight}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        />
      )}
      <div className="flex h-8 shrink-0 items-center border-b border-hairline bg-canvas-soft pr-1">
        <div
          role="tablist"
          aria-label={t("pages")}
          className="flex h-full min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
        >
          {view.pages.map((page) => (
            <PageTab
              key={page.id}
              page={page}
              active={page.id === view.activeId}
              running={running.get(page.id) ?? null}
            />
          ))}
        </div>
        <PanelButton label={newLabel} onClick={() => newPage()}>
          <Plus />
        </PanelButton>
        <div className="flex-1" />
        <PanelButton label={maximizeLabel} onClick={toggleMaximized}>
          {view.maximized ? <Minimize2 /> : <Maximize2 />}
        </PanelButton>
        <PanelButton label={hideLabel} onClick={hide}>
          <X />
        </PanelButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {view.pages.map((page) => (
          <TerminalPage
            key={page.id}
            id={page.id}
            cwd={page.cwd}
            command={page.command}
            active={page.id === view.activeId}
            shown={shown && page.id === view.activeId}
            focusSeq={view.focusSeq}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Onglet compact d'une page : titre tronqué (complet en infobulle), icône de chargement si un
 * processus tourne (sinon point d'activité), fermer.
 */
function PageTab({
  page,
  active,
  running,
}: {
  page: Page;
  active: boolean;
  /** Commande au premier plan, `null` si le shell attend. */
  running: string | null;
}) {
  const { t } = useTranslation("terminal");
  const { activate, requestClose } = useTerminalActions();
  const label = pageLabel(page);

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(page.id);
    }
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={label}
      onClick={() => activate(page.id)}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex h-full max-w-64 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r border-hairline pr-1 pl-2.5 outline-none select-none focus-visible:bg-canvas-soft-2",
        active ? "bg-canvas text-ink" : "text-mute hover:bg-canvas-soft-2",
      )}
    >
      <SquareTerminal className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate font-mono text-caption-mono">{label}</span>
      {running !== null ? (
        <LoaderCircle
          role="img"
          aria-label={t("running", { command: running })}
          className="size-3 shrink-0 text-mute motion-safe:animate-spin"
        />
      ) : (
        page.activity && (
          <span aria-label={t("newOutput")} className="size-1.5 shrink-0 rounded-full bg-link" />
        )
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("closePage", { label })}
        onClick={(event) => {
          event.stopPropagation();
          requestClose(page.id);
        }}
        className={cn(
          "grid size-5 shrink-0 place-content-center rounded-sm text-mute hover:bg-hairline hover:text-ink",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function PanelButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          className="text-mute"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Bouton « Terminal » à droite de la barre d'onglets : enfoncé quand le panneau est affiché. */
export function TerminalButton() {
  const { t } = useTranslation("terminal");
  const { visible } = useTerminalLayout();
  const { toggle } = useTerminalActions();
  const label = t("name");
  const tooltip = withHint(label, "terminal-toggle");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={visible}
          onClick={toggle}
          className={cn("text-mute", visible && "bg-hairline text-ink")}
        >
          <SquareTerminal />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
