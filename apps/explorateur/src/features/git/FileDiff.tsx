// Diff d'un fichier dans le volet Modifications : en-tête collant, blocs, contexte masqué à
// déplier, cas binaire, identique, trop long, changement de mode. Calculé à son approche.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Diff, DiffContent, DiffLine, FileChange, Hunk } from "@/bindings";
import { useHighlighted } from "@/features/preview/highlight";
import { formatSize } from "@/features/preview/format";
import { languageFor } from "@/features/preview/languages";
import { EntryIcon } from "@/features/tree/EntryIcon";
import { useWorkspace } from "@/features/workspace/context";
import { appErrorMessage } from "@/i18n/errors";
import { isAppError } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { fetchHiddenLines, useGitDiff } from "./api";
import { ActionButtons } from "./ActionButtons";
import { DiffLines, type LineTokens } from "./DiffLines";
import {
  changeActions,
  changeKey,
  entryOfChange,
  hunkStarts,
  isFoldedDir,
  sideTexts,
  splitPath,
  type ChangeAction,
} from "./model";
import { LineCounts } from "./StatusLetter";
import type { DiffMode } from "./width";

/** Marge d'approche : un diff est calculé un peu avant d'entrer à l'écran. */
const NEAR_MARGIN = "800px 0px";
/** Hauteur d'une ligne de code (`text-code`), pour réserver la place d'un diff pas encore lu. */
const LINE_HEIGHT = 20;

type Props = {
  rootPath: string;
  change: FileChange;
  mode: DiffMode;
  collapsed: boolean;
  onToggle: (change: FileChange) => void;
  /** Volet affiché : masqué, aucun diff n'est relu. */
  active: boolean;
  /** Zone qui défile (racine de l'`IntersectionObserver`). */
  scrollRoot: HTMLElement | null;
  /** Geste sur le fichier (`hunk` nul) ou sur un de ses blocs. */
  onAction: OnAction;
};

export type OnAction = (change: FileChange, action: ChangeAction, hunk: Hunk | null) => void;

export function FileDiff({
  rootPath,
  change,
  mode,
  collapsed,
  onToggle,
  active,
  scrollRoot,
  onAction,
}: Props) {
  const { t } = useTranslation("git");
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const conflict = change.status === "!";
  // Dossier non suivi replié : aucun diff à calculer (Rust ne sait pas en faire un).
  const folded = isFoldedDir(change);
  const query = useGitDiff(rootPath, change, active && near && !collapsed && !conflict && !folded);

  useEffect(() => {
    const element = ref.current;
    if (near || !element || !scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root: scrollRoot, rootMargin: NEAR_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, scrollRoot]);

  const pending = !collapsed && !conflict && !folded && query.data === undefined;
  const estimate = Math.min(change.added + change.removed, 200) + 8;

  return (
    <section
      ref={ref}
      data-git-diff={changeKey(change)}
      // Cible de ⌥↓ / ⌥↑ tant que ses blocs ne sont pas lus.
      data-git-pending={pending ? "" : undefined}
      aria-label={t("diff.label", { path: change.path })}
      className="border-b border-hairline"
    >
      <DiffHeader
        change={change}
        collapsed={collapsed}
        onToggle={() => onToggle(change)}
        onAction={(action) => onAction(change, action, null)}
      />
      {!collapsed &&
        (folded ? (
          <Note>{t("diff.foldedDir")}</Note>
        ) : conflict ? (
          <Note>{t("diff.conflict")}</Note>
        ) : query.isError ? (
          <Note>
            {t("diff.unreadable", {
              detail: isAppError(query.error) ? appErrorMessage(query.error) : String(query.error),
            })}
          </Note>
        ) : query.data ? (
          <DiffBody
            rootPath={rootPath}
            change={change}
            diff={query.data}
            mode={mode}
            onAction={onAction}
          />
        ) : (
          <div aria-hidden style={{ height: estimate * LINE_HEIGHT }} />
        ))}
    </section>
  );
}

function DiffHeader({
  change,
  collapsed,
  onToggle,
  onAction,
}: {
  change: FileChange;
  collapsed: boolean;
  onToggle: () => void;
  onAction: (action: ChangeAction) => void;
}) {
  const { t } = useTranslation("git");
  const { name, dir } = splitPath(change.path);
  return (
    // En-tête collant : bouton replier (le premier `button`, mesuré par ⌥↓) puis gestes.
    <div className="group sticky top-0 z-10 flex h-8 items-center border-b border-hairline bg-canvas-soft hover:bg-canvas-soft-2">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pr-3 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-mute motion-safe:transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        <EntryIcon
          entry={entryOfChange(change, "/")}
          open={false}
          className="size-4 shrink-0 text-mute"
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-body-sm">
          <span className="shrink-0 text-ink">
            {change.origPath !== null && `${splitPath(change.origPath).name} → `}
            {name}
          </span>
          {dir && (
            <span dir="rtl" className="min-w-0 truncate text-left text-caption text-mute">
              <bdi>{dir}</bdi>
            </span>
          )}
        </span>
        {change.staged && (
          <span className="shrink-0 rounded-xs bg-hairline px-1 text-caption text-body">
            {t("diff.stagedBadge")}
          </span>
        )}
        <LineCounts added={change.added} removed={change.removed} />
      </button>
      <ActionButtons
        actions={changeActions(change)}
        onAction={onAction}
        className="hidden pr-2 group-focus-within:flex group-hover:flex"
      />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-body-sm text-mute">{children}</p>;
}

function DiffBody({
  rootPath,
  change,
  diff,
  mode,
  onAction,
}: {
  rootPath: string;
  change: FileChange;
  diff: Diff;
  mode: DiffMode;
  onAction: OnAction;
}) {
  const { t } = useTranslation("git");
  return (
    <>
      {diff.oldMode !== null && diff.newMode !== null && (
        <p className="border-b border-hairline px-3 py-1 font-mono text-caption-mono text-mute">
          {t("diff.mode", { old: diff.oldMode, new: diff.newMode })}
        </p>
      )}
      <Content
        rootPath={rootPath}
        change={change}
        content={diff.content}
        mode={mode}
        onAction={onAction}
      />
    </>
  );
}

function Content({
  rootPath,
  change,
  content,
  mode,
  onAction,
}: {
  rootPath: string;
  change: FileChange;
  content: DiffContent;
  mode: DiffMode;
  onAction: OnAction;
}) {
  const { t } = useTranslation("git");
  switch (content.kind) {
    case "binary":
      return (
        <Note>
          {t("diff.binary")}
          <span className="ml-2 font-mono text-caption-mono">
            {content.oldSize === null ? t("diff.sizeNone") : formatSize(content.oldSize)} →{" "}
            {content.newSize === null ? t("diff.sizeNone") : formatSize(content.newSize)}
          </span>
        </Note>
      );
    case "identical":
      return (
        <Note>{change.status === "R" ? t("diff.renamedIdentical") : t("diff.identical")}</Note>
      );
    case "text":
      return (
        <TextDiff
          rootPath={rootPath}
          change={change}
          content={content}
          mode={mode}
          onAction={onAction}
        />
      );
  }
}

type TextContent = Extract<DiffContent, { kind: "text" }>;

/** Contexte déplié par trou (`gap`), valable pour un contenu de diff donné. */
type Expanded = { content: TextContent | null; lines: ReadonlyMap<number, DiffLine[]> };

function TextDiff({
  rootPath,
  change,
  content,
  mode,
  onAction,
}: {
  rootPath: string;
  change: FileChange;
  content: TextContent;
  mode: DiffMode;
  onAction: OnAction;
}) {
  const { t } = useTranslation("git");
  const { showError } = useWorkspace();
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState<Expanded>({ content: null, lines: new Map() });
  const [loadingGap, setLoadingGap] = useState<number | null>(null);
  const shown = !content.tooLong || revealed;
  // Un diff relu et différent invalide le contexte déplié (les trous ont pu bouger).
  const unfolded = expanded.content === content ? expanded.lines : null;

  const lang = shown ? languageFor(splitPath(change.path).name) : null;
  const all = useMemo(() => content.hunks.flatMap((hunk) => hunk.lines), [content]);
  const sides = useMemo(() => sideTexts(all), [all]);
  // Rang de la première ligne de chaque bloc dans `all`.
  const starts = useMemo(() => hunkStarts(content.hunks), [content]);
  const oldTokens = useHighlighted(sides.old, lang);
  const newTokens = useHighlighted(sides.new, lang);
  const hunkActions = changeActions(change);

  if (!shown) {
    return (
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-sm px-2 py-1 text-body-sm text-link hover:bg-canvas-soft-2"
        >
          {t("diff.show", { count: content.lineCount })}
        </button>
      </div>
    );
  }

  function expand(gap: number) {
    setLoadingGap(gap);
    fetchHiddenLines(rootPath, change, gap)
      .then((lines) =>
        setExpanded((current) => {
          const map = new Map(current.content === content ? current.lines : []);
          map.set(gap, lines);
          return { content, lines: map };
        }),
      )
      .catch((error: unknown) =>
        showError(isAppError(error) ? appErrorMessage(error) : t("diff.hiddenUnreadable")),
      )
      .finally(() => setLoadingGap(null));
  }

  const gapRow = (gap: number, count: number) => {
    if (count === 0) return null;
    const lines = unfolded?.get(gap);
    if (lines) return <HiddenLines key={`gap-${gap}`} lines={lines} lang={lang} mode={mode} />;
    return (
      <GapButton
        key={`gap-${gap}`}
        count={count}
        loading={loadingGap === gap}
        onClick={() => expand(gap)}
      />
    );
  };

  return (
    <div className="font-mono text-code text-ink">
      {content.hunks.map((hunk, i) => {
        const start = starts[i] ?? 0;
        const tokensOf: LineTokens = (_line, index) => {
          const at = sides.index[start + index];
          if (!at) return null;
          const tokens = at.side === "old" ? oldTokens : newTokens;
          return tokens?.[at.row] ?? null;
        };
        return [
          gapRow(i, hunk.hiddenBefore),
          <HunkLines
            key={`hunk-${i}`}
            hunk={hunk}
            mode={mode}
            tokensOf={tokensOf}
            actions={hunkActions}
            onAction={(action) => onAction(change, action, hunk)}
          />,
        ];
      })}
      {gapRow(content.hunks.length, content.hiddenAfter)}
    </div>
  );
}

function HunkLines({
  hunk,
  mode,
  tokensOf,
  actions,
  onAction,
}: {
  hunk: Hunk;
  mode: DiffMode;
  tokensOf: LineTokens;
  actions: readonly ChangeAction[];
  onAction: (action: ChangeAction) => void;
}) {
  return (
    <div data-git-hunk className="group/hunk relative">
      <DiffLines lines={hunk.lines} mode={mode} tokensOf={tokensOf} />
      <ActionButtons
        hunk
        actions={actions}
        onAction={onAction}
        className="absolute top-0.5 right-1 hidden rounded-sm border border-hairline bg-canvas p-0.5 font-sans shadow-level-1 group-hover/hunk:flex"
      />
    </div>
  );
}

/** Contexte déplié : coloré d'un seul appel (lignes consécutives de la nouvelle version). */
function HiddenLines({
  lines,
  lang,
  mode,
}: {
  lines: DiffLine[];
  lang: string | null;
  mode: DiffMode;
}) {
  const text = useMemo(() => lines.map((line) => line.text).join("\n"), [lines]);
  const tokens = useHighlighted(text, lang);
  return <DiffLines lines={lines} mode={mode} tokensOf={(_line, i) => tokens?.[i] ?? null} />;
}

function GapButton({
  count,
  loading,
  onClick,
}: {
  count: number;
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("git");
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="flex h-6 w-full items-center gap-1.5 bg-canvas-soft px-3 font-sans text-caption text-mute outline-none hover:bg-canvas-soft-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-60"
    >
      <ChevronsUpDown aria-hidden className="size-3" />
      {t("diff.gap", { count })}
    </button>
  );
}
