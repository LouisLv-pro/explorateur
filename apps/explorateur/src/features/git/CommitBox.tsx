// Bas du volet Modifications (docs/specs/git.md, lot 2) : message du commit, case « Modifier le
// dernier commit », bouton « Committer » / « Tout committer », sortie de git en cas d'échec.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gitAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { useWorkspace } from "@/features/workspace/context";
import { useLastCommitMessage, type GitActions } from "./api";
import { useGitPanel, useRemoteSync } from "./context";
import { ErrorBlock } from "./ErrorBlock";
import { canCommitAndPush } from "./remote";
import {
  checkAmend,
  commitButton,
  gitErrorText,
  loadDraft,
  saveDraft,
  uncheckAmend,
} from "./commit";

/** Le champ grandit de 2 à 8 lignes, puis défile. */
const MAX_ROWS = 8;

/** Dernière demande « Lier au commit » traitée par un champ de message (voir plus bas). */
let handledMessageSeq = 0;

function readDraft(root: string): string {
  try {
    return loadDraft(localStorage, root);
  } catch {
    return "";
  }
}

function storeDraft(root: string, message: string) {
  try {
    saveDraft(localStorage, root, message);
  } catch {
    // Non enregistré : le brouillon vaut pour la session.
  }
}

export function CommitBox({
  rootPath,
  stagedCount,
  active,
  actions,
}: {
  rootPath: string;
  stagedCount: number;
  /** Volet affiché : le dernier message n'est lu qu'alors. */
  active: boolean;
  actions: GitActions;
}) {
  const { t } = useTranslation("git");
  const { notify } = useWorkspace();
  const last = useLastCommitMessage(rootPath, active);
  const [message, setMessage] = useState(() => readDraft(rootPath));
  const [amend, setAmend] = useState(false);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // L'échec est gardé tel quel : son texte se compose au rendu, dans la langue active.
  const [error, setError] = useState<{ failure: unknown } | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const amendId = useId();
  const hasCommit = last.data !== undefined && last.data !== null;
  const button = commitButton({ message, amend, stagedCount, busy });
  const remote = useRemoteSync();
  // Proposé seulement si la branche a un remote ; grisé pendant un geste réseau.
  const showMenu = canCommitAndPush(remote.state);
  const canPush = showMenu && remote.busy === null;
  const pushHint = shortcutHint("git-commit-push");

  // « Lier au commit » a modifié le brouillon : le champ le relit et prend le focus, curseur à
  // la fin. Le dernier numéro traité est hors du composant : le champ n'existe qu'une fois le
  // statut lu, et un champ remonté (autre dossier racine) ne doit pas reprendre le focus.
  const { messageSeq } = useGitPanel();
  useEffect(() => {
    if (messageSeq === 0 || messageSeq === handledMessageSeq) return;
    handledMessageSeq = messageSeq;
    const draft = readDraft(rootPath);
    // Micro-tâche : `StrictMode` monte deux fois, et le texte doit être posé avant le focus.
    queueMicrotask(() => {
      setMessage(draft);
      const field = fieldRef.current;
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(draft.length, draft.length);
    });
  }, [messageSeq, rootPath]);

  // Hauteur du champ : son contenu, entre 2 lignes (`rows`) et 8.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Volet masqué (`display: none`) : `scrollHeight` vaut 0, la hauteur serait figée à rien.
    // Sans hauteur posée, `rows` donne les 2 lignes ; la prochaine frappe la recalcule.
    if (field.offsetParent === null) {
      field.style.height = "";
      return;
    }
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    // `border-box` : la hauteur compte bordures et marges ; `scrollHeight`, les marges seules.
    field.style.height = "auto";
    const content = Math.max(field.scrollHeight, line * 2 + padding);
    const height = Math.min(content, line * MAX_ROWS + padding) + border;
    field.style.height = `${height}px`;
  }, [message]);

  function changeMessage(next: string) {
    setMessage(next);
    storeDraft(rootPath, next);
  }

  function toggleAmend(checked: boolean) {
    setAmend(checked);
    if (checked) {
      const next = checkAmend(message, last.data ?? null);
      setPrefilled(next.prefilled);
      if (next.message !== message) changeMessage(next.message);
    } else {
      const next = uncheckAmend(message, prefilled);
      setPrefilled(null);
      if (next !== message) changeMessage(next);
    }
  }

  async function submit(thenPush = false) {
    if (button.disabled || (thenPush && !canPush)) return;
    setBusy(true);
    setError(null);
    let committed = false;
    try {
      const hash = await actions.commit(message, { amend, all: button.all });
      committed = true;
      changeMessage("");
      setAmend(false);
      setPrefilled(null);
      notify(t("commit.created", { hash }));
    } catch (failure) {
      setError({ failure });
    } finally {
      setBusy(false);
    }
    // Un push refusé garde le commit : son erreur s'affiche sous l'en-tête du volet.
    if (committed && thenPush) await remote.push();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = gitAction(event.nativeEvent, { inPanel: true });
    if (action !== "git-commit" && action !== "git-commit-push") return;
    event.preventDefault();
    void submit(action === "git-commit-push");
  }

  return (
    <div
      data-git-commit
      className="grid shrink-0 gap-2 border-t border-hairline bg-canvas-soft p-2"
    >
      <textarea
        ref={fieldRef}
        rows={2}
        value={message}
        readOnly={busy}
        aria-label={t("commit.message")}
        placeholder={t("commit.placeholder")}
        onChange={(event) => changeMessage(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-sm border border-input bg-canvas px-2 py-1.5 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 read-only:text-mute"
      />
      {error !== null && <ErrorBlock text={gitErrorText(error.failure)} />}
      <div className="flex items-center gap-2">
        <label
          htmlFor={amendId}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-body has-disabled:text-mute"
        >
          <input
            id={amendId}
            type="checkbox"
            checked={amend}
            disabled={!hasCommit || busy}
            onChange={(event) => toggleAmend(event.target.checked)}
            className="accent-primary"
          />
          <span className="truncate">{t("commit.amend")}</span>
        </label>
        <div className="flex">
          <Button
            size="sm"
            disabled={button.disabled}
            onClick={() => void submit()}
            className={showMenu ? "rounded-r-none" : undefined}
          >
            {busy && <LoaderCircle aria-hidden className="motion-safe:animate-spin" />}
            {button.label}
          </Button>
          {showMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  disabled={button.disabled}
                  aria-label={t("commit.more")}
                  className="rounded-l-none border-l-primary-foreground/25"
                >
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem disabled={!canPush} onSelect={() => void submit(true)}>
                  {t("commit.andPush")}
                  <DropdownMenuShortcut>{pushHint}</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
