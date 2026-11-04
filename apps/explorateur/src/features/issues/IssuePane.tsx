// Onglet d'une issue GitHub, en lecture (spec issues-github.md, lot 1) : en-tête (dépôt, gestes),
// titre, état, auteur, labels, assignés, puis le corps et les commentaires rendus en Markdown.
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, type ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  GitCommitHorizontal,
  Link,
  LoaderCircle,
  RotateCw,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { Comment, Issue } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGitPanel } from "@/features/git/context";
import { Message } from "@/features/preview/Message";
import { issueAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { isInTerminal } from "@/features/terminal/context";
import { issueTabRepo } from "@/features/tabs/tabs";
import { useWorkspace } from "@/features/workspace/context";
import { useIssue } from "./api";
import { IssueIcon } from "./IssueIcon";
import { LabelPills } from "./LabelPills";
import { exactDate, panelError, relativeDate, unavailableMessage } from "./model";
import { useIssueOpener } from "./open";
import { IssueRefsContext, type IssueRefs } from "./refsContext";

// Markdown et sa mise en page ne sont chargés qu'à la première ouverture d'une issue.
const IssueMarkdown = lazy(() => import("./IssueMarkdown"));

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Le focus est dans l'onglet, sur la barre d'onglets ou nulle part (⌘R), pas dans le terminal. */
function focusAllowsReload(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || isInTerminal(target)) return false;
  return (
    target === document.body ||
    target.closest("[data-issue-pane], [data-preview], [role=tablist][aria-label=Onglets]") !== null
  );
}

export function IssuePane({
  rootPath,
  tabPath,
  number,
}: {
  rootPath: string;
  /** Chemin de l'onglet (`issue:<owner/repo>#<N>`), pour le nom du dépôt. */
  tabPath: string;
  number: number;
}) {
  const { t } = useTranslation(["issues", "common"]);
  const query = useIssue(rootPath, number);
  const issue = query.data;
  const { notify, showError } = useWorkspace();
  const { linkIssue } = useGitPanel();
  const { openIssue } = useIssueOpener();
  // `#123` et liens d'issue du même dépôt dans le Markdown : ouverts en onglet.
  const repoName = issueTabRepo(tabPath);
  const refs = useMemo<IssueRefs>(
    () => ({ repoName, open: (target) => void openIssue(rootPath, target) }),
    [repoName, rootPath, openIssue],
  );

  // ⌘R : seul le volet visible écoute (`<Activity>` démonte les effets des autres).
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector(OVERLAY) !== null) return;
    if (issueAction(event) !== "issue-reload" || !focusAllowsReload(event.target)) return;
    event.preventDefault();
    void query.refetch();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(done);
    } catch {
      showError(t("common:copyFailed"));
    }
  }

  return (
    <div data-issue-pane className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline pr-3 pl-4">
        {issue && <IssueIcon state={issue.state} reason={issue.stateReason} className="size-4" />}
        <p className="min-w-0 flex-1 truncate text-body-sm">
          <span className="text-mute">{`${issueTabRepo(tabPath)} `}</span>
          <span className="text-ink">{`#${number}`}</span>
        </p>
        {query.isFetching && issue && (
          <LoaderCircle
            role="status"
            aria-label={t("reading")}
            className="size-3.5 shrink-0 text-mute motion-safe:animate-spin"
          />
        )}
        <BarButton
          label={t("pane.reload", { shortcut: shortcutHint("issue-reload") })}
          onClick={() => void query.refetch()}
        >
          <RotateCw />
        </BarButton>
        <BarButton
          label={t("pane.openOnGithub")}
          disabled={!issue}
          onClick={() => issue && void openUrl(issue.url).catch(() => {})}
        >
          <ExternalLink />
        </BarButton>
        <BarButton
          label={t("pane.copyLink")}
          disabled={!issue}
          onClick={() => issue && void copy(issue.url, t("pane.linkCopied"))}
        >
          <Link />
        </BarButton>
        <BarButton
          label={t("pane.copyNumber", { number })}
          onClick={() => void copy(`#${number}`, t("pane.numberCopied", { number }))}
        >
          <Copy />
        </BarButton>
        {issue?.state === "OPEN" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={() => linkIssue(number)}>
                <GitCommitHorizontal />
                {t("pane.linkToCommit")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("pane.linkToCommitHint", { number })}</TooltipContent>
          </Tooltip>
        )}
      </header>
      {issue ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <IssueRefsContext value={refs}>
            <IssueContent issue={issue} />
          </IssueRefsContext>
        </div>
      ) : query.isPending ? (
        <Message>
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-label={t("loading")} />
        </Message>
      ) : (
        <ErrorMessage error={query.error} number={number} onRetry={() => void query.refetch()} />
      )}
    </div>
  );
}

function ErrorMessage({
  error,
  number,
  onRetry,
}: {
  error: unknown;
  number: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation("issues");
  const notFound =
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    error.kind === "IssueNotFound";
  const failure = panelError(error);
  return (
    <Message>
      <p role="alert">
        {notFound
          ? t("notFound", { number })
          : "reason" in failure
            ? unavailableMessage(failure.reason)
            : t("readFailed")}
      </p>
      {!notFound && "output" in failure && failure.output !== "" && (
        <pre className="max-w-lg overflow-auto rounded-sm border border-hairline bg-canvas-soft-2 p-2 text-left font-mono text-caption-mono whitespace-pre-wrap text-body select-text">
          {failure.output}
        </pre>
      )}
      {!notFound && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </Message>
  );
}

function IssueContent({ issue }: { issue: Issue }) {
  const { t } = useTranslation("issues");
  const open = issue.state === "OPEN";
  return (
    <article className="mx-auto grid max-w-190 gap-4 px-8 py-8">
      <header className="grid gap-2">
        <h1 className="text-display-sm text-ink">
          {issue.title}
          <span className="font-normal text-mute">{` #${issue.number}`}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-mute">
          <span
            title={issue.stateReason ?? undefined}
            className={`inline-flex items-center gap-1 rounded-full border border-current px-2 py-0.5 ${
              open ? "text-issue-open" : "text-issue-closed"
            }`}
          >
            <IssueIcon state={issue.state} reason={issue.stateReason} className="size-3.5" />
            <span className="text-caption">{open ? t("state.open") : t("state.closed")}</span>
          </span>
          <span title={exactDate(issue.createdAt)}>
            {t("pane.openedBy", {
              author: issue.author ?? t("pane.deletedAccount"),
              when: relativeDate(issue.createdAt),
            })}
          </span>
        </div>
        <LabelPills labels={issue.labels} />
        {issue.assignees.length > 0 && (
          <p className="text-body-sm text-mute">
            {t("pane.assignedTo", { names: issue.assignees.join(", ") })}
          </p>
        )}
      </header>
      <Entry author={issue.author} date={issue.createdAt} body={issue.body} empty />
      {issue.comments.length > 0 && (
        <section aria-label={t("pane.comments")} className="grid gap-4">
          {issue.comments.map((comment, index) => (
            <Entry key={index} {...entryOf(comment)} />
          ))}
        </section>
      )}
    </article>
  );
}

function entryOf(comment: Comment) {
  return { author: comment.author, date: comment.createdAt, body: comment.body };
}

/** Le corps de l'issue ou un commentaire : auteur, date relative (exacte en infobulle), Markdown. */
function Entry({
  author,
  date,
  body,
  empty = false,
}: {
  author: string | null;
  date: string;
  body: string;
  /** Corps vide : « Aucune description. » (le corps de l'issue, pas un commentaire). */
  empty?: boolean;
}) {
  const { t } = useTranslation("issues");
  return (
    <section className="overflow-hidden rounded-md border border-hairline">
      <h2 className="flex items-baseline gap-2 border-b border-hairline bg-canvas-soft px-4 py-2 text-body-sm">
        <span className="font-medium text-ink">{author ?? t("pane.deletedAccount")}</span>
        <span className="text-mute" title={exactDate(date)}>
          {relativeDate(date)}
        </span>
      </h2>
      <div className="px-4 py-3">
        {body.trim() === "" ? (
          <p className="text-body-sm text-mute italic">{empty ? t("pane.noDescription") : ""}</p>
        ) : (
          <Suspense fallback={null}>
            <IssueMarkdown text={body} />
          </Suspense>
        )}
      </div>
    </section>
  );
}

function BarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
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
