// Panneau Navigateur (docs/specs/navigateur.md) : colonne à droite de l'aperçu, onglets, ligne
// d'adresse. La page est une webview native posée par Rust au-dessus de `data-browser-area` ;
// ce composant mesure la zone et envoie sa place. Sous la webview (masquée par un calque de
// l'app) reste un fond avec l'adresse, que le navigateur simulé (Vite) affiche seul.
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { type AppError, commands } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WidthHandle } from "@/components/WidthHandle";
import { defaultWidth } from "@/features/git/width";
import { shortcutHint } from "@/features/shortcuts/shortcuts";
import { appErrorMessage } from "@/i18n/errors";
import { cn } from "@/lib/utils";
import { useBrowserActions, useBrowserView } from "./context";
import { zoomFactor } from "@/features/zoom/appZoom";
import { windowRect } from "@/features/zoom/zoom";
import { tabLabel } from "./label";
import { browserWidth, loadBrowserWidth, saveBrowserWidth } from "./panel";
import { useSidePanel } from "./sidePanel";
import type { BrowserTab } from "./tabs";

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function readWidth(): number | null {
  try {
    return loadBrowserWidth(localStorage);
  } catch {
    return null;
  }
}

function storeWidth(width: number) {
  try {
    saveBrowserWidth(localStorage, width);
  } catch {
    // Non enregistrée : vaut pour la session.
  }
}

/** Largeur de la fenêtre, suivie au redimensionnement. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * Vrai tant qu'un menu, la palette, l'aide ou un dialogue est ouvert. Les calques Radix sont
 * des enfants directs du `body` : seul son ajout et son retrait sont observés.
 */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => document.querySelector(OVERLAY) !== null);
  useEffect(() => {
    const observer = new MutationObserver(() => setOpen(document.querySelector(OVERLAY) !== null));
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

export function BrowserPanel() {
  const { t } = useTranslation("browser");
  const { panel } = useSidePanel();
  const open = panel === "browser";
  const view = useBrowserView();
  const actions = useBrowserActions();
  const windowWidth = useWindowWidth();
  const overlay = useOverlayOpen();
  const [stored, setStored] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const lastLayout = useRef("");

  const active = view.tabs.tabs.find((tab) => tab.id === view.tabs.active);
  const width = browserWidth(stored, windowWidth);
  const maximized = view.maximized;
  const hideHint = shortcutHint("browser-toggle");
  const webviewShown = open && !overlay && !dragging && view.live.has(view.tabs.active);

  // Place la webview de l'onglet actif, ou les masque toutes : appelé après chaque rendu et à
  // chaque changement de taille ; une disposition identique n'est pas renvoyée.
  const sendLayout = useEffectEvent(() => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const visible = webviewShown && rect.width > 0 && rect.height > 0;
    // Le zoom de la page (spec zoom.md) change la taille d'un pixel CSS, pas celle des webviews
    // enfants, placées en pixels logiques de la fenêtre : on convertit.
    const zoom = zoomFactor();
    const layout = {
      active: visible ? view.tabs.active : null,
      ...windowRect(rect, zoom),
      viewportHeight: window.innerHeight * zoom,
    };
    const key = JSON.stringify(layout);
    if (key === lastLayout.current) return;
    lastLayout.current = key;
    void commands.browserLayout(layout);
  });
  useLayoutEffect(() => {
    sendLayout();
  });
  useEffect(() => {
    const area = areaRef.current;
    const column = panelRef.current?.parentElement;
    if (!area) return;
    const observer = new ResizeObserver(() => sendLayout());
    observer.observe(area);
    if (column) observer.observe(column);
    window.addEventListener("resize", sendLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendLayout);
    };
  }, []);

  return (
    <aside
      ref={panelRef}
      aria-label={t("name")}
      className={cn(
        "flex flex-col bg-canvas",
        maximized ? "absolute inset-0 z-30" : "relative shrink-0 border-l border-hairline",
        !open && "hidden",
      )}
      style={maximized ? undefined : { width }}
    >
      {!maximized && (
        <WidthHandle
          label={t("widthHandle")}
          width={width}
          onStart={() => setDragging(true)}
          onResize={(value) => setStored(value)}
          onCommit={(value) => {
            const clamped = browserWidth(value, windowWidth);
            setStored(clamped);
            storeWidth(clamped);
            setDragging(false);
          }}
          onReset={() => {
            const value = defaultWidth(windowWidth);
            setStored(value);
            storeWidth(value);
          }}
        />
      )}
      <div className="flex h-9 shrink-0 items-center border-b border-hairline bg-canvas-soft pr-1">
        <div
          role="tablist"
          aria-label={t("tabs")}
          className="flex h-full min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
        >
          {view.tabs.tabs.map((tab) => (
            <Tab
              key={tab.id}
              tab={tab}
              active={tab.id === view.tabs.active}
              loading={view.loading.has(tab.id)}
            />
          ))}
        </div>
        <PanelButton label={t("newTab")} onClick={actions.newTab}>
          <Plus />
        </PanelButton>
        <div className="flex-1" />
        <PanelButton
          label={maximized ? t("minimize") : t("maximize")}
          onClick={actions.toggleMaximized}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </PanelButton>
        <PanelButton label={t("hide", { shortcut: hideHint })} onClick={actions.hide}>
          <X />
        </PanelButton>
      </div>
      {active && (
        <AddressBar
          key={active.id}
          tab={active}
          live={view.live.has(active.id)}
          error={view.error}
          focusSeq={view.focusSeq}
        />
      )}
      <div
        ref={areaRef}
        data-browser-area
        className="grid min-h-0 flex-1 place-content-center justify-items-center gap-1 overflow-hidden px-6 text-center text-body-sm text-mute"
      >
        {active?.url ? (
          <>
            <Globe aria-hidden className="size-5" />
            <span className="max-w-full truncate font-mono text-caption-mono" title={active.url}>
              {active.url}
            </span>
          </>
        ) : (
          <>
            <Globe aria-hidden className="size-5" />
            <span>{t("empty.title")}</span>
            <span>{t("empty.hint")}</span>
          </>
        )}
      </div>
    </aside>
  );
}

/** Onglet du navigateur : titre (complet en infobulle), chargement, fermer au survol. */
function Tab({ tab, active, loading }: { tab: BrowserTab; active: boolean; loading: boolean }) {
  const { t } = useTranslation("browser");
  const actions = useBrowserActions();
  const label = tabLabel(tab);

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.activate(tab.id);
    }
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={label}
      onClick={() => actions.activate(tab.id)}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex h-full max-w-44 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r border-hairline pr-1 pl-2.5 outline-none select-none focus-visible:bg-canvas-soft-2",
        active ? "bg-canvas text-ink" : "text-mute hover:bg-canvas-soft-2",
      )}
    >
      {loading ? (
        <LoaderCircle
          role="img"
          aria-label={t("loading")}
          className="size-3.5 shrink-0 motion-safe:animate-spin"
        />
      ) : (
        <Globe className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="truncate text-body-sm">{label}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("closeTab", { label })}
        onClick={(event) => {
          event.stopPropagation();
          actions.closeTab(tab.id);
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

/** Ligne sous les onglets : précédent, suivant, recharger, champ d'URL, navigateur par défaut. */
function AddressBar({
  tab,
  live,
  error,
  focusSeq,
}: {
  tab: BrowserTab;
  live: boolean;
  error: AppError | null;
  focusSeq: number;
}) {
  const { t } = useTranslation("browser");
  const actions = useBrowserActions();
  const inputRef = useRef<HTMLInputElement>(null);
  // Texte en cours de saisie ; `null` : le champ montre l'adresse courante de l'onglet.
  const [draft, setDraft] = useState<string | null>(null);
  const blank = tab.url === "";

  const focusField = useEffectEvent(() => {
    if (blank) inputRef.current?.focus();
  });
  useEffect(() => {
    // Micro-tâche : `StrictMode` monte deux fois, le panneau doit être affiché.
    if (focusSeq > 0) queueMicrotask(focusField);
  }, [focusSeq]);
  // Un nouvel onglet vide (ou celui qu'on ouvre) prend le focus à son montage.
  useEffect(() => {
    queueMicrotask(focusField);
  }, []);

  function submit() {
    const text = (draft ?? tab.url).trim();
    if (text !== "") actions.navigate(tab.id, text);
    setDraft(null);
  }

  return (
    <div className="shrink-0 border-b border-hairline">
      <div className="flex items-center gap-0.5 px-1 py-1">
        <PanelButton label={t("back")} disabled={!live} onClick={() => actions.back(tab.id)}>
          <ArrowLeft />
        </PanelButton>
        <PanelButton label={t("forward")} disabled={!live} onClick={() => actions.forward(tab.id)}>
          <ArrowRight />
        </PanelButton>
        <PanelButton label={t("reload")} disabled={!live} onClick={() => actions.reload(tab.id)}>
          <RotateCw />
        </PanelButton>
        <input
          ref={inputRef}
          type="text"
          aria-label={t("address")}
          placeholder={t("addressPlaceholder")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={draft ?? tab.url}
          onChange={(event) => {
            setDraft(event.target.value);
            actions.clearError();
          }}
          onFocus={(event) => event.target.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          className="mx-1 h-7 min-w-0 flex-1 rounded-sm border border-hairline bg-canvas px-2 font-mono text-caption-mono text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <PanelButton
          label={t("openDefault")}
          disabled={blank}
          onClick={() => void openExternal(tab.url).catch(() => {})}
        >
          <ExternalLink />
        </PanelButton>
      </div>
      {error !== null && (
        <p role="alert" className="px-3 pb-1.5 text-caption text-error">
          {appErrorMessage(error)}
        </p>
      )}
    </div>
  );
}

function PanelButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Enveloppe : une infobulle sur un bouton désactivé ne reçoit pas le survol. */}
        <span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="text-mute"
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Bouton « Navigateur » à droite de la barre d'onglets : enfoncé quand le panneau est affiché. */
export function BrowserButton({ side = "bottom" }: { side?: "top" | "bottom" }) {
  const { t } = useTranslation("browser");
  const { panel } = useSidePanel();
  const { toggle } = useBrowserActions();
  const open = panel === "browser";
  const label = t("name");
  const hint = shortcutHint("browser-toggle");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={open}
          onClick={toggle}
          className={cn("text-mute", open && "bg-hairline text-ink")}
        >
          <Globe />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{t("withShortcut", { label, shortcut: hint })}</TooltipContent>
    </Tooltip>
  );
}
