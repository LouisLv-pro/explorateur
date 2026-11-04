import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";
import { LoaderCircle, MessageSquare, Plus, RotateCw, UserRound } from "lucide-react";
import type { IssueFilter, IssueSummary, RootFolder } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTerminalActions } from "@/features/terminal/context";
import { useWorkspace } from "@/features/workspace/context";
import { cn } from "@/lib/utils";
import { REFETCH_MIN_MS, useGithubRepo, useIssueList, useResetGithub } from "./api";
import { GhLoginWatcher, type LoginRun } from "./GhLogin";
import { IssueIcon } from "./IssueIcon";
import { LabelPills } from "./LabelPills";
import { useNewIssue } from "./composer";
import {
  FILTERS,
  ISSUE_LIMIT,
  emptyMessage,
  exactDate,
  filterIssues,
  issueTabName,
  loadFilter,
  panelError,
  relativeDate,
  saveFilter,
  unavailableMessage,
  type PanelError,
} from "./model";

const INSTALL_COMMAND = "brew install gh";
/** Nom propre, affiché tant que le dépôt n'est pas connu. */
const GITHUB = "GitHub";

/**
 * Vue Issues du panneau de gauche (⌃⇧I, spec issues-github.md) : en-tête (dépôt, Actualiser,
 * filtres), champ de filtre, liste. Montée dans `<Activity>` : filtre, texte du champ et
 * défilement survivent au passage par une autre vue. `focusSeq` change à chaque ⌃⇧I (et à
 * chaque réaffichage de la vue) : le champ reprend le focus.
 */
export function IssuesPanel({ root, focusSeq }: { root: RootFolder; focusSeq: number }) {
  const { t } = useTranslation("issues");
  const repo = useGithubRepo(root.path);
  const repoName = repo.data?.nameWithOwner ?? null;
  // Filtre exclusif gardé par dépôt : lu quand le dépôt est connu, puis choisi par l'utilisateur.
  const [chosen, setChosen] = useState<IssueFilter | null>(null);
  const filter = chosen ?? (repoName === null ? "open" : loadFilter(localStorage, repoName));
  const list = useIssueList(root.path, filter, repo.isSuccess);
  const reset = useResetGithub(root.path);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState<LoginRun | null>(null);
  const openNewIssue = useNewIssue();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  // Retour du focus sur la fenêtre : relecture au plus une fois par minute, vue affichée
  // (`<Activity>` démonte cet effet quand la vue est masquée).
  const onWindowFocus = useEffectEvent(() => {
    if (!repo.isSuccess) {
      if (repo.isError && !repo.isFetching && Date.now() - repo.errorUpdatedAt >= REFETCH_MIN_MS) {
        void repo.refetch();
      }
      return;
    }
    const last = Math.max(list.dataUpdatedAt, list.errorUpdatedAt);
    if (!list.isFetching && Date.now() - last >= REFETCH_MIN_MS) void list.refetch();
  });
  useEffect(() => {
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, []);

  function chooseFilter(next: IssueFilter) {
    setChosen(next);
    if (repoName !== null) saveFilter(localStorage, repoName, next);
  }

  function refresh() {
    void reset();
  }

  const error = repo.isError ? repo.error : list.isError ? list.error : null;
  const failure = error === null ? null : panelError(error);
  const loading = repo.isPending || (repo.isSuccess && list.isPending);
  const fetching = repo.isFetching || list.isFetching;
  const shown = useMemo(() => filterIssues(list.data ?? [], query), [list.data, query]);

  const startLogin = useTerminalActions().runCommand;
  const onSeen = useCallback(() => setLogin((l) => (l ? { ...l, seen: true } : l)), []);
  const onFinished = useCallback(() => {
    setLogin(null);
    void reset();
  }, [reset]);

  return (
    <div data-issues-view className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <div className="flex h-7 items-center gap-1">
          <p
            title={repoName ?? undefined}
            className="min-w-0 flex-1 truncate font-mono text-caption-mono text-body"
          >
            {repoName ?? GITHUB}
          </p>
          {fetching && !loading && (
            <LoaderCircle
              role="status"
              aria-label={t("reading")}
              className="size-3.5 shrink-0 text-mute motion-safe:animate-spin"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.newIssue")}
                disabled={repoName === null}
                onClick={() => repoName !== null && openNewIssue({ repoName })}
                className="text-mute"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("panel.newIssue")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.refresh")}
                onClick={refresh}
                className="text-mute"
              >
                <RotateCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("panel.refresh")}</TooltipContent>
          </Tooltip>
        </div>
        <div role="group" aria-label={t("panel.filterGroup")} className="mb-1.5 flex gap-0.5">
          {FILTERS.map((value) => (
            <Button
              key={value}
              variant="ghost"
              size="xs"
              aria-pressed={filter === value}
              onClick={() => chooseFilter(value)}
              className={cn(filter === value ? "bg-hairline text-ink" : "text-mute")}
            >
              {t(`filters.${value}`)}
            </Button>
          ))}
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              focusRow(event.currentTarget, "first");
            }
          }}
          placeholder={t("panel.filterPlaceholder")}
          aria-label={t("panel.filterLabel")}
          data-issues-filter
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-sm border border-hairline bg-canvas px-2 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-hairline-strong"
        />
      </div>
      {login && <GhLoginWatcher run={login} onSeen={onSeen} onFinished={onFinished} />}
      {failure ? (
        <FailureMessage
          failure={failure}
          onRetry={refresh}
          onLogin={() =>
            setLogin({
              pageId: startLogin(root.path, { label: "gh auth login", command: "gh auth login" }),
              seen: false,
              startedAt: Date.now(),
            })
          }
          logging={login !== null}
        />
      ) : loading ? (
        <p role="status" className="px-3 py-4 text-body-sm text-mute">
          {t("panel.loading")}
        </p>
      ) : (
        <IssueList
          issues={shown}
          total={list.data?.length ?? 0}
          filter={filter}
          query={query}
          repoName={repoName ?? ""}
          repoUrl={repo.data?.url ?? ""}
        />
      )}
    </div>
  );
}

/** Message d'un état « GitHub indisponible » (ou d'une erreur de `gh`), avec son geste. */
function FailureMessage({
  failure,
  onRetry,
  onLogin,
  logging,
}: {
  failure: PanelError;
  onRetry: () => void;
  onLogin: () => void;
  logging: boolean;
}) {
  const { t } = useTranslation(["issues", "common"]);
  const { notify, showError } = useWorkspace();
  const reason = "reason" in failure ? failure.reason : null;

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      notify(t("panel.installCopied"));
    } catch {
      showError(t("common:copyFailed"));
    }
  }

  return (
    <div role="alert" className="grid content-start justify-items-start gap-2 px-3 py-4">
      {reason === null ? (
        <>
          <p className="text-body-sm text-body">{t("panel.failed")}</p>
          {"output" in failure && failure.output !== "" && (
            <pre className="max-h-40 w-full overflow-auto rounded-sm border border-hairline bg-canvas-soft-2 p-2 font-mono text-caption-mono whitespace-pre-wrap text-body select-text">
              {failure.output}
            </pre>
          )}
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </>
      ) : (
        <>
          <p className="text-body-sm text-body">{unavailableMessage(reason)}</p>
          {reason === "ghNotFound" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyInstall()}
              title={t("panel.copyInstall")}
              className="font-mono"
            >
              {INSTALL_COMMAND}
            </Button>
          )}
          {reason === "notLoggedIn" && (
            <Button variant="outline" size="sm" disabled={logging} onClick={onLogin}>
              {t("panel.login")}
            </Button>
          )}
          {reason === "offline" && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Déplace le focus vers une ligne (`first`, `last`, `next`, `previous`) à partir de `from`. */
function focusRow(from: HTMLElement, where: "first" | "last" | "next" | "previous") {
  const list = from.closest("[data-issues-view]");
  const rows = Array.from(list?.querySelectorAll<HTMLElement>("[data-issue-row]") ?? []);
  if (rows.length === 0) return;
  const index = rows.indexOf(from);
  const target =
    where === "first"
      ? rows[0]
      : where === "last"
        ? rows.at(-1)
        : where === "next"
          ? rows[Math.min(index + 1, rows.length - 1)]
          : rows[index - 1];
  if (target) target.focus();
  else if (where === "previous") {
    list?.querySelector<HTMLInputElement>("input[data-issues-filter]")?.focus();
  }
}

function IssueList({
  issues,
  total,
  filter,
  query,
  repoName,
  repoUrl,
}: {
  issues: IssueSummary[];
  /** Taille de la liste lue, avant le filtre du champ. */
  total: number;
  filter: IssueFilter;
  query: string;
  repoName: string;
  repoUrl: string;
}) {
  const { t } = useTranslation("issues");
  const { openIssueTab } = useWorkspace();
  const [focused, setFocused] = useState<number | null>(null);
  const tabStop = issues.some((i) => i.number === focused) ? focused : (issues[0]?.number ?? null);

  function open(issue: IssueSummary, pin: boolean) {
    openIssueTab(repoName, issue.number, issueTabName(issue.number, issue.title), issue.state, {
      pin,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, issue: IssueSummary) {
    if (event.key === "Enter") {
      // ↵ épingle l'onglet ; sans preventDefault, le bouton déclencherait aussi son clic.
      event.preventDefault();
      open(issue, true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(event.currentTarget, event.key === "ArrowDown" ? "next" : "previous");
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusRow(event.currentTarget, event.key === "Home" ? "first" : "last");
    }
  }

  if (total === 0) {
    return <p className="px-3 py-4 text-body-sm text-mute">{emptyMessage(filter)}</p>;
  }
  return (
    <div aria-label={t("list.label")} className="min-h-0 flex-1 overflow-auto pb-2">
      {issues.length === 0 ? (
        <p className="px-3 py-4 text-body-sm text-mute">
          {t("list.noMatch", { query: query.trim() })}
        </p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.number}>
              <IssueRow
                issue={issue}
                tabStop={issue.number === tabStop}
                onFocus={() => setFocused(issue.number)}
                onOpen={() => open(issue, false)}
                onPin={() => open(issue, true)}
                onKeyDown={(event) => onKeyDown(event, issue)}
              />
            </li>
          ))}
        </ul>
      )}
      {total >= ISSUE_LIMIT && (
        <p className="px-3 pt-2 text-caption text-mute">
          <Trans
            t={t}
            i18nKey="list.limit"
            values={{ limit: ISSUE_LIMIT }}
            components={[
              <a
                key="more"
                href={`${repoUrl}/issues`}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(`${repoUrl}/issues`).catch(() => {});
                }}
                className="text-link underline underline-offset-2"
              />,
            ]}
          />
        </p>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  tabStop,
  onFocus,
  onOpen,
  onPin,
  onKeyDown,
}: {
  issue: IssueSummary;
  tabStop: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onPin: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation("issues");
  return (
    <button
      type="button"
      data-issue-row
      tabIndex={tabStop ? 0 : -1}
      onFocus={onFocus}
      onClick={onOpen}
      onDoubleClick={onPin}
      onKeyDown={onKeyDown}
      className="grid w-full gap-1 border-b border-hairline px-3 py-2 text-left outline-none hover:bg-canvas-soft-2 focus-visible:bg-canvas-soft-2"
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <IssueIcon state={issue.state} className="mt-0.5 size-3.5 shrink-0" />
        <span className="shrink-0 font-mono text-caption-mono text-mute">{`#${issue.number}`}</span>
        <span title={issue.title} className="min-w-0 truncate text-body-sm text-ink">
          {issue.title}
        </span>
      </span>
      <LabelPills labels={issue.labels} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-mute">
        {issue.author !== null && <span>{issue.author}</span>}
        <span title={exactDate(issue.updatedAt)}>
          {t("list.updated", { when: relativeDate(issue.updatedAt) })}
        </span>
        {issue.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title={t("list.comments")}>
            <MessageSquare className="size-3" aria-hidden />
            {issue.commentCount}
            <span className="sr-only">
              {` ${t("list.commentWord", { count: issue.commentCount })}`}
            </span>
          </span>
        )}
        {issue.assignees.length > 0 && (
          <span className="inline-flex items-center gap-0.5" title={t("list.assignedTo")}>
            <UserRound className="size-3" aria-hidden />
            {issue.assignees.join(", ")}
          </span>
        )}
      </span>
    </button>
  );
}
