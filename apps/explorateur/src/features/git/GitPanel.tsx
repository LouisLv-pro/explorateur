// Volet Modifications (docs/specs/git.md) : colonne à droite de l'aperçu et du terminal,
// largeur réglable, liste des modifications puis diffs empilés (lot 1) ; indexer, désindexer,
// annuler et committer (lot 2), avec le champ du commit en bas.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, GitCompare, ListChevronsDownUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileChange, Head, Hunk, RepoStatus, RootFolder } from "@/bindings";
import { Button } from "@/components/ui/button";
import { WidthHandle } from "@/components/WidthHandle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { reloadDocument } from "@/features/editor/documents";
import { gitAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { tabKey } from "@/features/tabs/tabs";
import { useWorkspace } from "@/features/workspace/context";
import i18n from "@/i18n";
import { appErrorMessage } from "@/i18n/errors";
import { isAppError } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { gitDiffRootKey, gitIndexTextRootKey, useGitActions, useGitStatus } from "./api";
import { ChangeSection, type SectionId } from "./ChangeList";
import { CommitBox } from "./CommitBox";
import { gitErrorText } from "./commit";
import { useGitPanel, useRemoteSync } from "./context";
import { DiscardDialog, type DiscardTarget } from "./DiscardDialog";
import { ErrorBlock } from "./ErrorBlock";
import { RemoteControls } from "./RemoteControls";
import { FileDiff } from "./FileDiff";
import {
  canOpen,
  changedFileCount,
  changeKey,
  entryOfChange,
  listOrder,
  type ChangeAction,
} from "./model";
import {
  MIN_SPLIT_WIDTH,
  defaultWidth,
  effectiveMode,
  loadDiffMode,
  loadWidth,
  panelWidth,
  saveDiffMode,
  saveWidth,
  type DiffMode,
} from "./width";

function readStored<T>(load: (storage: Storage) => T, fallback: T): T {
  try {
    return load(localStorage);
  } catch {
    return fallback;
  }
}

function store(save: (storage: Storage) => void) {
  try {
    save(localStorage);
  } catch {
    // Non enregistré : vaut pour la session.
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

const DIFF_MODES: readonly DiffMode[] = ["unified", "split"];

/** Branche, ou « détaché @ abc1234 » (les composants qui l'affichent suivent la langue). */
const headLabel = (head: Head) =>
  head.kind === "branch" ? head.name : i18n.t("git:panel.detached", { hash: head.shortHash });

export function GitPanel({ root }: { root: RootFolder }) {
  const { t } = useTranslation("git");
  const { open, focusSeq, hide } = useGitPanel();
  const { openFile, tabs, showError } = useWorkspace();
  const queryClient = useQueryClient();
  const status = useGitStatus(root.path, open);
  const actions = useGitActions(root.path);
  const remote = useRemoteSync();
  const [discard, setDiscard] = useState<DiscardTarget | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const windowWidth = useWindowWidth();
  const [storedWidth, setStoredWidth] = useState(() => readStored(loadWidth, null));
  const [mode, setMode] = useState<DiffMode>(() => readStored(loadDiffMode, "unified"));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [sections, setSections] = useState<ReadonlySet<SectionId>>(new Set());
  const [currentKey, setCurrentKey] = useState<string | null>(null);

  const width = panelWidth(storedWidth, windowWidth);
  const shownMode = effectiveMode(mode, width);
  const data = status.data;
  const changes = listOrder(data);

  // Un statut relu et différent (sondage : `git add` dans le terminal) relit les diffs affichés.
  const lastData = useRef(data);
  useEffect(() => {
    if (lastData.current !== undefined && lastData.current !== data) {
      void queryClient.invalidateQueries(
        { queryKey: gitDiffRootKey(root.path) },
        { cancelRefetch: false },
      );
      // Gouttière : l'index a pu changer sans changement disque (`git add` du terminal).
      void queryClient.invalidateQueries(
        { queryKey: gitIndexTextRootKey(root.path) },
        { cancelRefetch: false },
      );
    }
    lastData.current = data;
  }, [data, queryClient, root.path]);

  // ⌃⇧G ou bouton : focus sur la ligne courante de la liste, sinon sur le volet.
  useEffect(() => {
    if (focusSeq === 0) return;
    // Micro-tâche : `StrictMode` monte deux fois, le volet doit être affiché.
    queueMicrotask(() => {
      const panel = panelRef.current;
      const row =
        panel?.querySelector<HTMLElement>('[data-git-row][tabindex="0"]') ??
        panel?.querySelector<HTMLElement>("[data-git-row]");
      (row ?? panel)?.focus({ preventScroll: true });
    });
  }, [focusSeq]);

  // Ligne qui reçoit le focus au clavier : la dernière focalisée si elle existe encore.
  const first = changes.at(0);
  const rowKey = changes.some((c) => changeKey(c) === currentKey)
    ? currentKey
    : first
      ? changeKey(first)
      : null;

  function reveal(change: FileChange) {
    const key = changeKey(change);
    setCollapsed((set) => {
      if (!set.has(key)) return set;
      const next = new Set(set);
      next.delete(key);
      return next;
    });
    requestAnimationFrame(() => {
      const target = scrollRoot?.querySelector<HTMLElement>(`[data-git-diff="${CSS.escape(key)}"]`);
      target?.scrollIntoView({ block: "start" });
    });
  }

  function openChange(change: FileChange) {
    if (canOpen(change)) openFile(entryOfChange(change, root.path), { pin: true });
  }

  /** Onglet ouvert sur le fichier de `change` (pas pour un fichier hors du dossier racine). */
  function tabOf(change: FileChange) {
    if (change.outsideRoot) return undefined;
    const path = entryOfChange(change, root.path).path;
    return tabs.find((tab) => tab.path === path);
  }

  const reportError = (error: unknown) => showError(gitErrorText(error));

  // Gestes du lot 2 : fichier (`hunk` nul) ou bloc. Annuler passe par la confirmation ; un non
  // suivi s'annule en entier (corbeille).
  function runAction(change: FileChange, action: ChangeAction, hunk: Hunk | null = null) {
    if (action === "discard") {
      setDiscard({ change, hunk: change.status === "U" ? null : hunk });
      return;
    }
    const done =
      action === "stage"
        ? hunk
          ? actions.stageHunk(change, hunk)
          : actions.stageFile(change)
        : hunk
          ? actions.unstageHunk(change, hunk)
          : actions.unstageFile(change);
    done.catch(reportError);
  }

  function runAll(id: SectionId) {
    (id === "staged" ? actions.unstageAll() : actions.stageAll()).catch(reportError);
  }

  function confirmDiscard(target: DiscardTarget) {
    setDiscard(null);
    const tab = tabOf(target.change);
    const done = target.hunk
      ? actions.discardHunk(target.change, target.hunk)
      : actions.discardFile(target.change);
    done
      .then(() => {
        // Sans modifications, le rechargement automatique (`DiskChanged`) relit l'onglet ; avec,
        // la confirmation l'a dit : le texte du disque remplace celui de l'éditeur.
        if (tab?.dirty) void reloadDocument(tabKey(tab), tab.path);
      })
      .catch(reportError);
  }

  function toggleCollapsed(change: FileChange) {
    const key = changeKey(change);
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allCollapsed = changes.length > 0 && changes.every((c) => collapsed.has(changeKey(c)));
  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(changes.map(changeKey)));
  }

  function toggleSection(id: SectionId) {
    setSections((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chooseMode(next: DiffMode) {
    setMode(next);
    store((s) => saveDiffMode(s, next));
  }

  // ⌥↓ / ⌥↑ : bloc suivant / précédent (ou diff pas encore lu), sous l'en-tête collant.
  function jumpHunk(direction: 1 | -1) {
    if (!scrollRoot) return;
    const top = scrollRoot.getBoundingClientRect().top;
    const targets = [
      ...scrollRoot.querySelectorAll<HTMLElement>("[data-git-hunk], [data-git-pending]"),
    ];
    const offsetOf = (el: HTMLElement) => {
      const header = el.closest("[data-git-diff]")?.querySelector("button");
      const sticky = el.hasAttribute("data-git-pending") ? 0 : (header?.offsetHeight ?? 0);
      return el.getBoundingClientRect().top - top - sticky;
    };
    const target =
      direction === 1
        ? targets.find((el) => offsetOf(el) > 2)
        : targets.reverse().find((el) => offsetOf(el) < -2);
    if (target) scrollRoot.scrollBy({ top: offsetOf(target) });
  }

  function moveRow(direction: 1 | -1, from: HTMLElement) {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-git-row]") ?? [])];
    const next = rows[rows.indexOf(from) + direction];
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    // Le champ du message garde ses touches (⌥↓, ↵) ; ⌘↵ y est lu par `CommitBox`.
    if ((event.target as HTMLElement).closest("[data-git-commit]")) return;
    const action = gitAction(event.nativeEvent, { inPanel: true });
    if (action === null || action === "git-toggle") return;
    const target = event.target as HTMLElement;
    const rowKeyOf = target.getAttribute("data-git-row");
    const change = changes.find((c) => changeKey(c) === rowKeyOf);
    switch (action) {
      case "git-next-hunk":
      case "git-previous-hunk":
        event.preventDefault();
        jumpHunk(action === "git-next-hunk" ? 1 : -1);
        break;
      case "git-list-next":
      case "git-list-previous":
        if (rowKeyOf === null) return;
        event.preventDefault();
        moveRow(action === "git-list-next" ? 1 : -1, target);
        break;
      case "git-show-diff":
        if (!change) return;
        event.preventDefault();
        reveal(change);
        break;
      case "git-open":
        if (!change) return;
        event.preventDefault();
        openChange(change);
        break;
    }
  }

  return (
    <aside
      ref={panelRef}
      data-git-panel
      tabIndex={-1}
      aria-label={t("panel.label")}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex shrink-0 flex-col border-l border-hairline bg-canvas outline-none",
        !open && "hidden",
      )}
      style={{ width }}
    >
      <WidthHandle
        label={t("panel.width")}
        width={width}
        onResize={(value) => setStoredWidth(value)}
        onCommit={(value) => {
          const clamped = panelWidth(value, windowWidth);
          setStoredWidth(clamped);
          store((s) => saveWidth(s, clamped));
        }}
        onReset={() => {
          const value = defaultWidth(windowWidth);
          setStoredWidth(value);
          store((s) => saveWidth(s, value));
        }}
      />
      <PanelHeader
        status={data}
        mode={mode}
        splitAllowed={width >= MIN_SPLIT_WIDTH}
        onMode={chooseMode}
        allCollapsed={allCollapsed}
        onToggleAll={toggleAll}
        onHide={hide}
      />
      {remote.error !== null && (
        <ErrorBlock
          text={remote.error}
          onClose={remote.dismissError}
          className="shrink-0 border-b border-hairline bg-canvas-soft p-2"
        />
      )}
      <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-y-auto">
        {status.isError ? (
          <PanelMessage>
            {t("panel.failed", {
              detail: isAppError(status.error)
                ? appErrorMessage(status.error)
                : String(status.error),
            })}
          </PanelMessage>
        ) : data === undefined ? null : data.kind === "notARepo" ? (
          <PanelMessage>{t("panel.notARepo")}</PanelMessage>
        ) : data.kind === "gitNotFound" ? (
          <PanelMessage>
            {t("panel.gitNotFound")}
            <span className="font-mono text-caption-mono">{data.path}</span>
          </PanelMessage>
        ) : changes.length === 0 ? (
          <PanelMessage>
            {t("panel.noChanges")}
            <span className="flex items-center gap-1 font-mono text-caption-mono">
              <GitBranch aria-hidden className="size-3.5" />
              {headLabel(data.head)}
            </span>
          </PanelMessage>
        ) : (
          <>
            <div className="border-b border-hairline py-1">
              {data.staged.length > 0 && (
                <ChangeSection
                  id="staged"
                  title={t("panel.staged")}
                  changes={data.staged}
                  collapsed={sections.has("staged")}
                  onToggle={toggleSection}
                  onAll={runAll}
                  currentKey={rowKey}
                  onReveal={reveal}
                  onOpen={openChange}
                  onFocusRow={setCurrentKey}
                  onAction={runAction}
                />
              )}
              {data.unstaged.length > 0 && (
                <ChangeSection
                  id="unstaged"
                  title={t("panel.unstaged")}
                  changes={data.unstaged}
                  collapsed={sections.has("unstaged")}
                  onToggle={toggleSection}
                  onAll={runAll}
                  currentKey={rowKey}
                  onReveal={reveal}
                  onOpen={openChange}
                  onFocusRow={setCurrentKey}
                  onAction={runAction}
                />
              )}
            </div>
            {changes.map((change) => (
              <FileDiff
                key={changeKey(change)}
                rootPath={root.path}
                change={change}
                mode={shownMode}
                collapsed={collapsed.has(changeKey(change))}
                onToggle={toggleCollapsed}
                active={open}
                scrollRoot={scrollRoot}
                onAction={runAction}
              />
            ))}
          </>
        )}
      </div>
      {data?.kind === "repo" && (
        <CommitBox
          rootPath={root.path}
          stagedCount={data.staged.length}
          active={open}
          actions={actions}
        />
      )}
      {discard && (
        <DiscardDialog
          target={discard}
          unsaved={tabOf(discard.change)?.dirty === true}
          onCancel={() => setDiscard(null)}
          onConfirm={confirmDiscard}
        />
      )}
    </aside>
  );
}

function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-10 text-center text-body-sm text-mute">
      {children}
    </div>
  );
}

function PanelHeader({
  status,
  mode,
  splitAllowed,
  onMode,
  allCollapsed,
  onToggleAll,
  onHide,
}: {
  status: RepoStatus | undefined;
  mode: DiffMode;
  splitAllowed: boolean;
  onMode: (mode: DiffMode) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation("git");
  const shown = splitAllowed ? mode : "unified";
  const hideLabel = t("panel.hide", { shortcut: shortcutHint("git-toggle") });
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hairline bg-canvas-soft pr-1 pl-3">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body-sm text-ink">
        {status?.kind === "repo" && (
          <>
            <GitBranch aria-hidden className="size-3.5 shrink-0 text-mute" />
            <span className="truncate" title={headLabel(status.head)}>
              {headLabel(status.head)}
            </span>
          </>
        )}
      </span>
      {status?.kind === "repo" && (
        <>
          <RemoteControls />
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Enveloppe : une infobulle sur un bouton désactivé ne reçoit pas le survol. */}
              <span
                role="group"
                aria-label={t("mode.label")}
                className="flex rounded-sm border border-hairline p-0.5"
              >
                {DIFF_MODES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={shown === value}
                    disabled={!splitAllowed}
                    onClick={() => onMode(value)}
                    className={cn(
                      "rounded-xs px-1.5 text-mute outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:text-mute",
                      shown === value && "bg-hairline text-ink disabled:hover:text-ink",
                    )}
                  >
                    {/* Taille hors de `cn` : tailwind-merge confond `text-caption` et `text-mute`. */}
                    <span className="text-caption">{t(`mode.${value}`)}</span>
                  </button>
                ))}
              </span>
            </TooltipTrigger>
            {!splitAllowed && (
              <TooltipContent side="bottom">
                {t("mode.splitNeeds", { width: MIN_SPLIT_WIDTH })}
              </TooltipContent>
            )}
          </Tooltip>
          <HeaderButton
            label={allCollapsed ? t("panel.expandAll") : t("panel.collapseAll")}
            onClick={onToggleAll}
          >
            <ListChevronsDownUp />
          </HeaderButton>
        </>
      )}
      <HeaderButton label={hideLabel} onClick={onHide}>
        <X />
      </HeaderButton>
    </div>
  );
}

function HeaderButton({
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
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Bouton « Modifications » de la barre d'onglets, à gauche du bouton Terminal : enfoncé quand
 * le volet est affiché, nombre de fichiers modifiés (masqué à 0).
 */
export function GitButton({ root }: { root: RootFolder }) {
  const { t } = useTranslation("git");
  const { open, toggle } = useGitPanel();
  const { data } = useGitStatus(root.path, open);
  const count = changedFileCount(data);
  // Lot 3 : branche à côté du compteur, tronquée, complète dans l'infobulle.
  const branch = data?.kind === "repo" ? headLabel(data.head) : null;
  // `↑A ↓B` n'est que dans l'en-tête du volet : collé au compteur, il se lisait mal.
  const label = t("button.label");
  const counted = count > 0 ? t("button.withCount", { label, files: count }) : label;
  const shortcut = shortcutHint("git-toggle");
  const tooltip = t("button.tooltip", { label, shortcut });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={count > 0 || branch !== null ? "sm" : "icon-sm"}
          aria-label={
            branch === null ? counted : t("button.withBranch", { label: counted, branch })
          }
          aria-pressed={open}
          onClick={toggle}
          className={cn("text-mute", open && "bg-hairline text-ink")}
        >
          <GitCompare />
          {branch !== null && <span className="max-w-32 truncate text-body-sm">{branch}</span>}
          {count > 0 && (
            // Taille sur la pastille elle-même : sinon elle prend la hauteur de ligne du bouton.
            <span className="text-caption-mono">
              <span
                className={cn(
                  "block rounded-xs px-1 font-mono text-ink",
                  open ? "bg-hairline-strong" : "bg-hairline",
                )}
              >
                {count}
              </span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {branch === null ? tooltip : `${branch} · ${tooltip}`}
      </TooltipContent>
    </Tooltip>
  );
}
