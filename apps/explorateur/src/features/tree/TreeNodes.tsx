import {
  memo,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight, File, Folder, LoaderCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Entry } from "@/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ContextActionItems } from "@/features/file-actions/actions";
import { useGitMarksContext } from "@/features/git/context";
import { entryMark, nameClass, STATUS_STYLE, type EntryMark } from "@/features/git/marks";
import { StatusLetter } from "@/features/git/StatusLetter";
import { ReadDot } from "@/features/last-read/ReadDot";
import { OpenInTerminalItem } from "@/features/terminal/OpenInTerminalItem";
import { cn } from "@/lib/utils";
import { isAppError } from "@/lib/ipc";
import { parentPath } from "@/lib/paths";
import { useWorkspace, useWorkspaceActions } from "@/features/workspace/context";
import { filePreviewQuery } from "@/features/preview/api";
import { useDirectory } from "./api";
import { shortcutAction } from "@/features/shortcuts/shortcuts";
import { startEntryDrag } from "./drag";
import { useTreeEdit } from "./edit";
import { directionOf, moveFocus, ROW_ATTR, useTreeKeyboard } from "./keyboard";
import { EntryIcon } from "./EntryIcon";
import { focusNameField, NameField } from "./NameField";

/** Retrait d'une ligne : 8 px de marge, puis 12 px par niveau. */
const indent = (depth: number, extra = 0): CSSProperties => ({
  paddingLeft: 8 + depth * 12 + extra,
});

type TreeProps = {
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
};

/** Contenu d'un dossier : ses entrées, ou un message (chargement, vide, accès refusé). */
export function DirectoryChildren({ path, ...props }: TreeProps & { path: string }) {
  const { t } = useTranslation("tree");
  const { showHidden } = useWorkspace();
  const { editing, submit, cancel } = useTreeEdit();
  const query = useDirectory(path, showHidden);
  const creating = editing?.mode === "create" && editing.dir === path ? editing : null;

  // Champ de nom de la création, en tête des enfants du dossier.
  const field = creating && (
    <NameField
      key={`create-${creating.kind}`}
      icon={creating.kind === "dir" ? <Folder /> : <File />}
      style={indent(props.depth)}
      label={creating.kind === "dir" ? t("nameField.newFolder") : t("nameField.newFile")}
      onSubmit={submit}
      onCancel={cancel}
    />
  );

  if (query.isPending) {
    return (
      <>
        {field}
        <MessageRow depth={props.depth}>
          <LoaderCircle
            className="size-3.5 motion-safe:animate-spin"
            aria-label={t("message.loading")}
          />
        </MessageRow>
      </>
    );
  }
  if (query.isError) {
    const denied = isAppError(query.error) && query.error.kind === "PermissionDenied";
    return (
      <>
        {field}
        <MessageRow depth={props.depth}>
          {denied ? t("message.denied") : t("message.unreadable")}
        </MessageRow>
      </>
    );
  }
  if (query.data.length === 0) {
    return (
      <>
        {field}
        {!field && <MessageRow depth={props.depth}>{t("message.empty")}</MessageRow>}
      </>
    );
  }
  return (
    <>
      {field}
      {query.data.map((entry, index) => (
        <TreeItem
          key={entry.path}
          entry={entry}
          first={props.depth === 0 && index === 0}
          {...props}
        />
      ))}
    </>
  );
}

/** Position de fin de la sélection initiale d'un renommage : avant la dernière extension. */
function selectionEnd(entry: Entry): number {
  const dot = entry.name.lastIndexOf(".");
  return entry.is_dir || dot <= 0 ? entry.name.length : dot;
}

function TreeItem({
  entry,
  first,
  depth,
  expanded,
  onToggle,
}: TreeProps & {
  entry: Entry;
  /** Première entrée de la racine : focalisable par Tab tant qu'aucune autre ne l'est. */
  first: boolean;
}) {
  const { t } = useTranslation("tree");
  const { root, currentFile } = useWorkspace();
  const { editing, submit, cancel } = useTreeEdit();
  const { tabStop, reveal, onRevealed, onFocusEntry } = useTreeKeyboard();
  const { marks } = useGitMarksContext();
  const mark = root ? entryMark(marks, root.path, entry.path, entry.is_dir) : NO_MARK;
  const open = entry.is_dir && expanded.has(entry.path);
  const renaming = editing?.mode === "rename" && editing.path === entry.path;
  // ⇧⌘E : l'entrée demandée prend le focus dès qu'elle est affichée (ses dossiers parents
  // viennent d'être dépliés, leurs enfants peuvent arriver après).
  const revealed =
    reveal !== null && (reveal.path === entry.path || (reveal.path === null && first));

  return (
    <>
      {renaming ? (
        <NameField
          icon={<EntryIcon entry={entry} open={open} aria-hidden />}
          style={indent(depth)}
          initial={entry.name}
          selectEnd={selectionEnd(entry)}
          label={t("nameField.rename", { name: entry.name })}
          onSubmit={submit}
          onCancel={cancel}
        />
      ) : (
        <TreeRow
          entry={entry}
          depth={depth}
          open={open}
          selected={!entry.is_dir && currentFile?.path === entry.path}
          focusable={tabStop === entry.path || (tabStop === null && first)}
          revealed={revealed}
          status={mark.status}
          ignored={mark.ignored}
          rootPath={root?.path}
          onToggle={onToggle}
          onFocusEntry={onFocusEntry}
          onRevealed={onRevealed}
        />
      )}
      {open && (
        <DirectoryChildren
          path={entry.path}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
        />
      )}
    </>
  );
}

/**
 * Ligne d'une entrée, hors renommage. Mémoïsée : ouvrir un fichier ou déplacer le focus ne
 * redessine que les lignes dont l'état change (props primitives et rappels stables), pas
 * toute l'arborescence avec ses menus contextuels.
 */
const TreeRow = memo(function TreeRow({
  entry,
  depth,
  open,
  selected,
  focusable,
  revealed,
  status,
  ignored,
  rootPath,
  onToggle,
  onFocusEntry,
  onRevealed,
}: {
  entry: Entry;
  depth: number;
  open: boolean;
  selected: boolean;
  focusable: boolean;
  revealed: boolean;
  status: EntryMark["status"];
  ignored: boolean;
  rootPath: string | undefined;
  onToggle: (path: string) => void;
  onFocusEntry: (path: string) => void;
  onRevealed: () => void;
}) {
  const { openFile } = useWorkspaceActions();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mark: EntryMark = { status, ignored };

  // Survol d'un fichier : sa lecture commence avant le clic (lecture seule, sans effet de bord).
  const startPrefetch = () => {
    if (entry.is_dir) return;
    hoverTimer.current = setTimeout(
      () => void queryClient.prefetchQuery(filePreviewQuery(entry.path)),
      HOVER_PREFETCH_MS,
    );
  };
  const stopPrefetch = () => clearTimeout(hoverTimer.current);
  useEffect(() => stopPrefetch, []);

  useEffect(() => {
    if (!revealed || !ref.current) return;
    ref.current.focus();
    ref.current.scrollIntoView({ block: "nearest" });
    onRevealed();
  }, [revealed, onRevealed]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const action = shortcutAction(event.nativeEvent, { inField: false, inTree: true });
    if (action === null) return;
    const direction = directionOf(action);
    if (direction) {
      // Toujours pris : la flèche ne fait pas défiler le panneau.
      event.preventDefault();
      moveFocus(event.currentTarget, direction, onToggle);
    } else if (action === "tree-open" || action === "tree-open-pinned") {
      // Pris avant le clic natif du bouton ; le focus reste dans l'arborescence.
      event.preventDefault();
      if (entry.is_dir) onToggle(entry.path);
      else openFile(entry, { pin: action === "tree-open-pinned" || undefined });
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          title={entry.name}
          {...{ [ROW_ATTR]: "" }}
          data-path={entry.path}
          data-dir={entry.is_dir}
          data-depth={depth}
          tabIndex={focusable ? 0 : -1}
          aria-expanded={entry.is_dir ? open : undefined}
          aria-current={selected ? "true" : undefined}
          onFocus={() => onFocusEntry(entry.path)}
          onKeyDown={onKeyDown}
          onPointerEnter={startPrefetch}
          onPointerLeave={stopPrefetch}
          // Clic : onglet provisoire ; ⌘clic ou double-clic : onglet épinglé. Le clic donne
          // aussi le focus (WebKit ne le donne pas aux boutons cliqués).
          onClick={(event) => {
            event.currentTarget.focus();
            if (entry.is_dir) onToggle(entry.path);
            else openFile(entry, { pin: event.metaKey || undefined });
          }}
          onDoubleClick={() => {
            if (!entry.is_dir) openFile(entry, { pin: true });
          }}
          // Déposée sur le terminal : insère son chemin (spec terminal.md).
          draggable
          onDragStart={(event) => startEntryDrag(event, entry.path)}
          style={indent(depth)}
          // Focus : anneau (comme les boutons), distinct du fond de l'entrée du fichier actif.
          className={cn(
            "flex h-6.5 w-full items-center gap-1 pr-2 text-left text-body outline-none hover:bg-canvas-soft-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
            selected && "bg-hairline text-ink hover:bg-hairline",
          )}
        >
          {entry.is_dir ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-mute motion-safe:transition-transform",
                open && "rotate-90",
              )}
              aria-hidden
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <EntryIcon entry={entry} open={open} className="size-4 shrink-0 text-mute" aria-hidden />
          {/* Taille hors de `cn` : tailwind-merge confond `text-body-sm` et `text-body`. */}
          <span className={`truncate text-body-sm ${nameClass(mark) ?? ""}`}>{entry.name}</span>
          {/* Point « modifié depuis votre dernière lecture », puis repère git : tous deux à droite. */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <ReadDot rootPath={rootPath} path={entry.path} isDir={entry.is_dir} open={open} />
            <GitMarkSign mark={mark} isDir={entry.is_dir} />
          </span>
        </button>
      </ContextMenuTrigger>
      {/* Pas de retour du focus au bouton : le champ de nom ouvert par le menu le prend. */}
      <ContextMenuContent className="w-64" onCloseAutoFocus={focusNameFieldInstead}>
        <TreeEditItems entry={entry} />
        <ContextMenuSeparator />
        <OpenInTerminalItem path={entry.path} isDir={entry.is_dir} />
        <ContextActionItems path={entry.path} isDir={entry.is_dir} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * Fermeture du menu : le focus va au champ de nom s'il est ouvert, pas au bouton. Le champ
 * monté pendant que le menu se ferme (dossier déplié par « Nouveau… », enfants lus en
 * asynchrone) perd sinon le focus pris au montage : le piège à focus du menu le reprend.
 */
export function focusNameFieldInstead(event: Event) {
  event.preventDefault();
  focusNameField();
}

/** « Nouveau fichier », « Nouveau dossier » (dans le dossier, ou dans le parent d'un fichier), « Renommer ». */
function TreeEditItems({ entry }: { entry: Entry }) {
  const { t } = useTranslation("tree");
  const { startCreate, startRename } = useTreeEdit();
  const dir = entry.is_dir ? entry.path : parentPath(entry.path);
  return (
    <>
      <ContextMenuItem onSelect={() => startCreate(dir, "file")}>
        {t("menu.newFile")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => startCreate(dir, "dir")}>
        {t("menu.newFolder")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => startRename(entry.path, entry.is_dir)}>
        {t("menu.rename")}
      </ContextMenuItem>
    </>
  );
}

const NO_MARK: EntryMark = { status: null, ignored: false };

/** Survol avant lecture anticipée : un simple passage de la souris ne lit rien. */
const HOVER_PREFETCH_MS = 100;

/** Repère git à droite d'une entrée : lettre de statut d'un fichier, point d'un dossier. */
function GitMarkSign({ mark, isDir }: { mark: EntryMark; isDir: boolean }) {
  // Abonne le composant à la langue : `STATUS_STYLE[x].label` est traduit à la lecture.
  const { t } = useTranslation("tree");
  if (mark.status === null) return null;
  if (!isDir) {
    return (
      <span className="ml-auto pl-1 text-caption-mono">
        <StatusLetter status={mark.status} />
      </span>
    );
  }
  const { label, dot } = STATUS_STYLE[mark.status];
  return (
    <span
      role="img"
      aria-label={t("changes.label", { status: label.toLowerCase() })}
      title={t("changes.title")}
      className={cn("mr-0.5 ml-auto size-1.5 shrink-0 rounded-full", dot)}
    />
  );
}

function MessageRow({ depth, children }: { depth: number; children: ReactNode }) {
  // Aligné sur les noms : chevron (14 px) + icône (16 px) + écarts.
  return (
    <div
      style={indent(depth, 22)}
      className="flex h-6.5 items-center text-body-sm text-mute select-none"
    >
      {children}
    </div>
  );
}
