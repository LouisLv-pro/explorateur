import {
  Activity,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronsDownUp, CircleDot, Eye, EyeOff, FolderTree, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RootFolder } from "@/bindings";
import { ContentSearchPanel } from "@/features/content-search/ContentSearchPanel";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RootMenu } from "@/features/folders/RootMenu";
import { IssuesPanel } from "@/features/issues/IssuesPanel";
import { HelpButton } from "@/features/shortcuts/HelpDialog";
import { issueAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { globalAction, useShortcuts } from "@/features/shortcuts/useShortcuts";
import { LanguageMenu } from "@/features/language/LanguageMenu";
import { AppThemeMenu } from "@/features/theme/ThemeProvider";
import { useWorkspace } from "@/features/workspace/context";
import { cn } from "@/lib/utils";
import { TreeEditProvider, useTreeEdit } from "./edit";
import { ROW_ATTR, TreeKeyboardContext, useTypeAhead, type RevealRequest } from "./keyboard";
import { ancestorDirs } from "./navigation";
import { useTreeExpanded } from "./treeExpanded";
import {
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
  clampTreeWidth,
  readTreeWidth,
  writeTreeWidth,
} from "./treeWidth";
import { DirectoryChildren, focusNameFieldInstead } from "./TreeNodes";
import { parentPath } from "@/lib/paths";

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Panneau de gauche : arborescence du dossier racine. Monté avec `key={root.path}` :
 * changer de dossier racine relit les dossiers dépliés de l'autre dossier.
 */
export function TreePanel({
  root,
  hidden,
  onShow,
  onHelp,
}: {
  root: RootFolder;
  /** Masqué par ⌥⌘S : le panneau reste monté (dépliés, recherche, largeur gardés). */
  hidden: boolean;
  /** Réaffiche le panneau masqué (⌘⇧F, ⇧⌘E). */
  onShow: () => void;
  onHelp: () => void;
}) {
  const { t } = useTranslation("tree");
  const { showHidden, toggleHidden, currentFile } = useWorkspace();
  // Largeur relue au montage, enregistrée à la fin d'un redimensionnement (largeur-arborescence.md).
  const [width, setWidth] = useState(readTreeWidth);
  // Saut par frappe : taper les lettres d'un nom donne le focus à l'entrée (saut-par-frappe.md).
  const onTypeAhead = useTypeAhead();
  // Vue du panneau : arborescence, recherche dans le contenu (⌘⇧F) ou issues GitHub (⌃⇧I).
  const [view, setView] = useState<"tree" | "search" | "issues">("tree");
  // Change à chaque ⌘⇧F : le champ de recherche reprend le focus.
  const [searchFocus, setSearchFocus] = useState(0);
  // Change à chaque ⌃⇧I : le champ de filtre des issues reprend le focus.
  const [issuesFocus, setIssuesFocus] = useState(0);
  // Dossiers dépliés, par chemin : un repli du parent ne les oublie pas. Gardés par dossier
  // racine d'un lancement à l'autre (spec continuite.md).
  const [expanded, setExpanded] = useTreeExpanded(root.path);
  // Dernière entrée focalisée (clic, flèches) et demande de focus de ⇧⌘E.
  const [focused, setFocused] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);

  // ⌘⇧F (`event.key` insensible à la casse : `F` avec Maj, quelle que soit la disposition).
  // Écouteur d'avant la table des raccourcis : il agit même avec un menu ouvert.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (globalAction(event) === "content-search") {
      event.preventDefault();
      onShow();
      setView("search");
      setSearchFocus((n) => n + 1);
    } else if (
      !event.defaultPrevented &&
      document.querySelector(OVERLAY) === null &&
      issueAction(event) === "issues-open"
    ) {
      // ⌃⇧I : le terminal le laisse passer (`terminalTakesKey`).
      event.preventDefault();
      onShow();
      setView("issues");
      setIssuesFocus((n) => n + 1);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ⇧⌘E : focus sur le fichier de l'onglet actif, dossiers parents dépliés ; sans onglet, sur
  // la première entrée.
  useShortcuts((action, event) => {
    if (action !== "reveal-in-tree") return;
    event.preventDefault();
    onShow();
    setView("tree");
    const path = currentFile?.path ?? null;
    if (path !== null) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const dir of ancestorDirs(path, root.path)) next.add(dir);
        return next;
      });
    }
    setReveal({ path });
  });

  // Entrée focalisable par Tab : la dernière focalisée, sinon celle du fichier actif, si elle
  // est affichée (dossiers parents dépliés) ; sinon la première (`null`).
  const isShown = (path: string) =>
    path.startsWith(`${root.path}/`) &&
    ancestorDirs(path, root.path).every((dir) => expanded.has(dir));
  const tabStop =
    [focused, currentFile?.path ?? null].find(
      (path): path is string => path !== null && isShown(path),
    ) ?? null;
  const onRevealed = useCallback(() => setReveal(null), []);
  const keyboard = useMemo(
    () => ({ tabStop, reveal, onRevealed, onFocusEntry: setFocused }),
    [tabStop, reveal, onRevealed],
  );

  const toggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [setExpanded],
  );

  const expand = useCallback(
    (path: string) => setExpanded((prev) => new Set(prev).add(path)),
    [setExpanded],
  );

  const hiddenLabel = showHidden ? t("panel.hideHidden") : t("panel.showHidden");

  return (
    <TreeEditProvider onExpand={expand}>
      <aside
        style={{ width }}
        className={cn(
          "relative flex h-full shrink-0 flex-col border-r border-hairline bg-canvas-soft",
          hidden && "hidden",
        )}
      >
        {/* h-9 : même hauteur que la barre d'onglets, les deux bordures du bas s'alignent. */}
        <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-hairline px-1.5">
          <RootMenu root={root} />
          <IconButton
            label={t("panel.tree")}
            onClick={() => setView("tree")}
            pressed={view === "tree"}
          >
            <FolderTree />
          </IconButton>
          <IconButton
            label={t("panel.search")}
            hint={t("panel.searchHint")}
            onClick={() => setView("search")}
            pressed={view === "search"}
          >
            <Search />
          </IconButton>
          <IconButton
            label={t("panel.issues")}
            hint={t("panel.issuesHint", { shortcut: shortcutHint("issues-open") })}
            onClick={() => {
              setView("issues");
              setIssuesFocus((n) => n + 1);
            }}
            pressed={view === "issues"}
          >
            <CircleDot />
          </IconButton>
          {/* L'œil n'est proposé que dans l'arborescence ; la recherche suit ce réglage. */}
          {view === "tree" && (
            <IconButton label={hiddenLabel} onClick={toggleHidden} pressed={showHidden}>
              {showHidden ? <EyeOff /> : <Eye />}
            </IconButton>
          )}
          {view === "tree" && (
            <IconButton label={t("panel.collapseAll")} onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp />
            </IconButton>
          )}
        </header>
        {/* Chaque vue reste montée, masquée : dépliés, requête et résultats survivent au changement. */}
        <Activity mode={view === "tree" ? "visible" : "hidden"}>
          {/* Clic droit sur le fond (hors entrée) : créer à la racine. Le menu d'une entrée
              appelle `preventDefault`, celui-ci ne s'ouvre alors pas. */}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <nav
                aria-label={t("panel.tree")}
                onKeyDown={onTypeAhead}
                className="min-h-0 flex-1 overflow-auto py-1"
              >
                <TreeKeyboardContext value={keyboard}>
                  <DirectoryChildren
                    path={root.path}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                  />
                </TreeKeyboardContext>
              </nav>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64" onCloseAutoFocus={focusNameFieldInstead}>
              <RootCreateItems rootPath={root.path} />
            </ContextMenuContent>
          </ContextMenu>
        </Activity>
        {/* Hors de `<Activity>` : écoute aussi depuis la recherche et les issues. */}
        <CreateShortcuts
          rootPath={root.path}
          onShow={() => {
            onShow();
            setView("tree");
          }}
        />
        <Activity mode={view === "search" ? "visible" : "hidden"}>
          <ContentSearchPanel root={root} focusSeq={searchFocus} />
        </Activity>
        <Activity mode={view === "issues" ? "visible" : "hidden"}>
          <IssuesPanel root={root} focusSeq={issuesFocus} />
        </Activity>
        {/* Pied du panneau : boutons de l'app, alignés à gauche. */}
        <footer className="flex h-9 shrink-0 items-center gap-0.5 border-t border-hairline px-1.5">
          <AppThemeMenu />
          <LanguageMenu />
          <HelpButton onClick={onHelp} />
        </footer>
        <ResizeHandle width={width} onResize={setWidth} onResizeEnd={writeTreeWidth} />
      </aside>
    </TreeEditProvider>
  );
}

/** Menu du fond de l'arborescence : « Nouveau fichier » et « Nouveau dossier » à la racine. */
function RootCreateItems({ rootPath }: { rootPath: string }) {
  const { t } = useTranslation("tree");
  const { startCreate } = useTreeEdit();
  const fileHint = shortcutHint("tree-new-file");
  const folderHint = shortcutHint("tree-new-folder");
  return (
    <>
      <ContextMenuItem onSelect={() => startCreate(rootPath, "file")}>
        {t("menu.newFile")}
        <span className="ml-auto text-mute">{fileHint}</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => startCreate(rootPath, "dir")}>
        {t("menu.newFolder")}
        <span className="ml-auto text-mute">{folderHint}</span>
      </ContextMenuItem>
    </>
  );
}

/**
 * ⌘N et ⇧⌘N : crée dans le dossier de l'entrée focalisée de l'arborescence (le dossier
 * lui-même, ou le parent d'un fichier), sinon à la racine. Réaffiche l'arborescence.
 */
function CreateShortcuts({ rootPath, onShow }: { rootPath: string; onShow: () => void }) {
  const { startCreate } = useTreeEdit();
  useShortcuts((action, event) => {
    if (action !== "tree-new-file" && action !== "tree-new-folder") return;
    event.preventDefault();
    onShow();
    const row = document.activeElement?.closest<HTMLElement>(`[${ROW_ATTR}]`);
    const path = row?.dataset.path;
    const dir =
      path === undefined ? rootPath : row?.dataset.dir === "true" ? path : parentPath(path);
    startCreate(dir, action === "tree-new-file" ? "file" : "dir");
  });
  return null;
}

function IconButton({
  label,
  hint = label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  /** Texte de l'infobulle, `label` par défaut. */
  hint?: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(pressed ? "bg-hairline text-ink" : "text-mute")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Poignée sur le bord droit du panneau : glisser pour régler sa largeur (`MIN_TREE_WIDTH` à `MAX_TREE_WIDTH`). */
function ResizeHandle({
  width,
  onResize,
  onResizeEnd,
}: {
  width: number;
  onResize: (w: number) => void;
  /** Largeur finale, à la fin du glisser. */
  onResizeEnd: (w: number) => void;
}) {
  const { t } = useTranslation("tree");
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let last = startWidth;
    const move = (e: globalThis.PointerEvent) => {
      last = clampTreeWidth(startWidth + e.clientX - startX);
      onResize(last);
    };
    const stop = () => {
      onResizeEnd(last);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("panel.resize")}
      aria-valuenow={width}
      aria-valuemin={MIN_TREE_WIDTH}
      aria-valuemax={MAX_TREE_WIDTH}
      onPointerDown={onPointerDown}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-hairline-strong"
    />
  );
}
