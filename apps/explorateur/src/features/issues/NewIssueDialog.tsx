// Dialogue « Nouvelle issue » (docs/specs/issues-github.md, lot 2, décision 0010) : titre, corps
// Markdown (éditeur CodeMirror, aperçu), labels, assignés, modèles, brouillon gardé par dépôt.
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueTemplate } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextEditor } from "@/features/editor/TextEditor";
import { ErrorBlock } from "@/features/git/ErrorBlock";
import { issueAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { useWorkspace } from "@/features/workspace/context";
import { cn } from "@/lib/utils";
import { useAssignees, useCreateIssue, useCurrentUser, useIssueTemplates, useLabels } from "./api";
import {
  BODY_MODES,
  addAssignee,
  canCreate,
  createErrorText,
  defaultBodyMode,
  draftFromTemplate,
  searchLabels,
  searchLogins,
  toggle,
  type BodyMode,
} from "./create";
import {
  EMPTY_DRAFT,
  clearIssueDraft,
  isEmptyDraft,
  loadIssueDraft,
  saveIssueDraft,
  type IssueDraft,
} from "./draft";
import { LabelPill } from "./LabelPills";
import { issueTabName } from "./model";

const IssueMarkdown = lazy(() => import("./IssueMarkdown"));

/** Clé du libellé de chaque mode du corps. */
const MODE_KEYS = {
  write: "create.modeWrite",
  split: "create.modeSplit",
  preview: "create.modePreview",
} as const satisfies Record<BodyMode, string>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dossier racine (où `gh` est lancé). */
  root: string;
  /** `owner/repo` : clé du brouillon et des onglets d'issue. */
  repoName: string;
  /** Avertissement affiché au-dessus du formulaire (lien de lignes qui peut différer, lot 3). */
  notice?: string | null;
};

/** Dialogue de création. Son contenu n'est monté qu'ouvert : les listes sont lues à l'ouverture. */
export function NewIssueDialog({ open, onOpenChange, root, repoName, notice = null }: Props) {
  // Pas de fermeture pendant la création : Échap, croix et clic dehors sont ignorés.
  const busyRef = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busyRef.current) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        // Le focus est posé par le formulaire (titre, ou premier modèle).
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex h-[85vh] max-h-[46rem] flex-col gap-3 sm:max-w-5xl"
      >
        <NewIssueForm
          root={root}
          repoName={repoName}
          notice={notice}
          busyRef={busyRef}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function readDraft(repoName: string): IssueDraft | null {
  try {
    return loadIssueDraft(localStorage, repoName);
  } catch {
    return null;
  }
}

function NewIssueForm({
  root,
  repoName,
  notice,
  busyRef,
  onClose,
}: {
  root: string;
  repoName: string;
  notice: string | null;
  busyRef: { current: boolean };
  onClose: () => void;
}) {
  const { t } = useTranslation(["issues", "common"]);
  const { notify, openIssueTab } = useWorkspace();
  const [initialDraft] = useState(() => readDraft(repoName));
  const [fields, setFields] = useState<IssueDraft>(initialDraft ?? EMPTY_DRAFT);
  // Un brouillon, ou un modèle déjà choisi : le formulaire. Sinon le choix de modèle, s'il y en a.
  const [picked, setPicked] = useState(initialDraft !== null);
  const [error, setError] = useState<string | null>(null);
  const [chosenMode, setChosenMode] = useState<BodyMode | null>(null);
  const [dialogWidth, setDialogWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const templates = useIssueTemplates(root);
  const create = useCreateIssue(root);
  const busy = create.isPending;
  const templateList = templates.data ?? [];
  const view = picked
    ? "form"
    : templates.isPending
      ? "loading"
      : templateList.length > 0
        ? "choose"
        : "form";
  const mode = chosenMode ?? defaultBodyMode(dialogWidth);

  // Largeur du dialogue (Scindé par défaut dès 900 px), suivie tant que le mode n'est pas choisi.
  useEffect(() => {
    const dialog = rootRef.current?.closest<HTMLElement>("[data-slot=dialog-content]");
    if (!dialog) return;
    setDialogWidth(dialog.offsetWidth);
    const observer = new ResizeObserver(() => setDialogWidth(dialog.offsetWidth));
    observer.observe(dialog);
    return () => observer.disconnect();
  }, []);

  // Focus : le titre (curseur à la fin d'un titre de modèle), ou le premier modèle.
  useEffect(() => {
    const target = rootRef.current?.querySelector<HTMLInputElement | HTMLButtonElement>(
      "[data-autofocus]",
    );
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement) {
      target.setSelectionRange(target.value.length, target.value.length);
    }
    // Seul un changement d'écran redonne le focus, pas chaque frappe.
  }, [view]);

  function update(patch: Partial<IssueDraft>) {
    const next = { ...fields, ...patch };
    setFields(next);
    saveIssueDraft(localStorage, repoName, next);
  }

  function pickTemplate(template: IssueTemplate | null) {
    if (template !== null) {
      const next = draftFromTemplate(template);
      setFields(next);
      saveIssueDraft(localStorage, repoName, next);
    }
    setPicked(true);
  }

  function clearDraft() {
    clearIssueDraft(localStorage, repoName);
    setFields(EMPTY_DRAFT);
    setError(null);
    rootRef.current?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus();
  }

  async function submit() {
    if (view !== "form" || !canCreate(fields.title, busy)) return;
    setError(null);
    busyRef.current = true;
    const issue = { ...fields, title: fields.title.trim() };
    try {
      const number = await create.mutateAsync(issue);
      clearIssueDraft(localStorage, repoName);
      busyRef.current = false;
      onClose();
      notify(t("create.created", { number }));
      openIssueTab(repoName, number, issueTabName(number, issue.title), "OPEN", { pin: true });
    } catch (failure) {
      busyRef.current = false;
      setError(createErrorText(failure));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // CodeMirror prend ⌘↵ lui-même (et le marque traité) : un seul déclenchement.
    if (event.defaultPrevented || issueAction(event.nativeEvent) !== "issue-create") return;
    event.preventDefault();
    void submit();
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-3"
      data-new-issue
    >
      <DialogHeader className="flex-row items-center gap-2 pr-10">
        <DialogTitle className="text-body-lg text-ink">{t("create.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("create.description", { repo: repoName })}
        </DialogDescription>
        <span className="flex-1" />
        {view === "form" && templateList.length > 0 && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => setPicked(false)}>
            {t("create.templates")}
          </Button>
        )}
        {view === "form" && !isEmptyDraft(fields) && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={clearDraft}>
            {t("create.clearDraft")}
          </Button>
        )}
      </DialogHeader>

      {view === "loading" && (
        <p role="status" className="py-4 text-body-sm text-mute">
          {t("create.loadingTemplates")}
        </p>
      )}
      {view === "choose" && <TemplateChoice templates={templateList} onPick={pickTemplate} />}
      {view === "form" && (
        <>
          {notice !== null && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-sm bg-warning-soft px-3 py-2 text-body-sm text-warning-deep"
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_15rem] gap-4">
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              <label className="grid gap-1 text-caption text-body">
                {t("create.titleField")}
                <input
                  data-autofocus
                  value={fields.title}
                  readOnly={busy}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder={t("create.titlePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full rounded-sm border border-input bg-canvas px-2 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 read-only:text-mute"
                />
              </label>
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-caption text-body">{t("create.bodyField")}</span>
                  <div role="group" aria-label={t("create.bodyView")} className="flex gap-0.5">
                    {BODY_MODES.map((value) => (
                      <Button
                        key={value}
                        variant="ghost"
                        size="xs"
                        aria-pressed={mode === value}
                        onClick={() => setChosenMode(value)}
                        className={cn(mode === value ? "bg-hairline text-ink" : "text-mute")}
                      >
                        {t(MODE_KEYS[value])}
                      </Button>
                    ))}
                  </div>
                </div>
                <div
                  className={cn(
                    "grid min-h-0 flex-1 gap-2",
                    mode === "split" ? "grid-cols-2" : "grid-cols-1",
                  )}
                >
                  {/* Masqué en mode Aperçu plutôt que démonté : historique et curseur restent. */}
                  <div
                    className={cn(
                      "flex min-h-0 min-w-0 overflow-hidden rounded-sm border border-input bg-canvas focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50",
                      mode === "preview" && "hidden",
                    )}
                  >
                    <TextEditor
                      value={fields.body}
                      onChange={(body) => update({ body })}
                      readOnly={busy}
                      fileName="corps.md"
                      label={t("create.editorLabel")}
                      placeholderText={t("create.editorPlaceholder")}
                      onSubmit={() => void submit()}
                    />
                  </div>
                  {mode !== "write" && (
                    <div
                      aria-label={t("create.previewLabel")}
                      className="min-h-0 min-w-0 overflow-auto rounded-sm border border-hairline bg-canvas px-3 py-2"
                    >
                      {fields.body.trim() === "" ? (
                        <p className="text-body-sm text-mute">{t("create.nothingToPreview")}</p>
                      ) : (
                        <Suspense fallback={null}>
                          <IssueMarkdown text={fields.body} />
                        </Suspense>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <aside className="flex min-h-0 flex-col gap-3">
              <LabelPicker
                root={root}
                selected={fields.labels}
                disabled={busy}
                onToggle={(name) => update({ labels: toggle(fields.labels, name) })}
              />
              <AssigneePicker
                root={root}
                selected={fields.assignees}
                disabled={busy}
                onToggle={(login) => update({ assignees: toggle(fields.assignees, login) })}
                onAssignMe={(login) => update({ assignees: addAssignee(fields.assignees, login) })}
              />
            </aside>
          </div>
          {error !== null && <ErrorBlock text={error} label={t("create.ghOutput")} />}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-caption text-mute">
              {t("create.submitHint", { shortcut: shortcutHint("issue-create") })}
            </span>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {t("common:cancel")}
              </Button>
            </DialogClose>
            <Button disabled={!canCreate(fields.title, busy)} onClick={() => void submit()}>
              {busy && <LoaderCircle aria-hidden className="motion-safe:animate-spin" />}
              {t("create.submit")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Écran d'ouverture quand le dépôt a des modèles : un modèle, ou « Issue vierge ». */
function TemplateChoice({
  templates,
  onPick,
}: {
  templates: readonly IssueTemplate[];
  onPick: (template: IssueTemplate | null) => void;
}) {
  const { t } = useTranslation("issues");
  const row =
    "grid w-full gap-0.5 rounded-sm border border-hairline px-3 py-2 text-left outline-none hover:bg-canvas-soft-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <ul
      aria-label={t("create.templateList")}
      className="grid min-h-0 flex-1 content-start gap-2 overflow-auto"
    >
      {templates.map((template, index) => (
        <li key={template.fileName}>
          <button
            type="button"
            data-autofocus={index === 0 ? "" : undefined}
            onClick={() => onPick(template)}
            className={row}
          >
            <span className="text-body-sm text-ink">{template.name}</span>
            {template.description !== "" && (
              <span className="text-caption text-mute">{template.description}</span>
            )}
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => onPick(null)} className={row}>
          <span className="text-body-sm text-ink">{t("create.blankIssue")}</span>
          <span className="text-caption text-mute">{t("create.noTemplate")}</span>
        </button>
      </li>
    </ul>
  );
}

const SEARCH_CLASS =
  "h-7 w-full rounded-sm border border-input bg-canvas px-2 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/** Cadre commun des listes à cocher : titre, recherche, liste défilante. */
function Picker({
  title,
  placeholder,
  searchLabel,
  action,
  query,
  onQuery,
  children,
}: {
  title: string;
  /** Texte d'aide du champ de recherche et son nom accessible. */
  placeholder: string;
  searchLabel: string;
  action?: ReactNode;
  query: string;
  onQuery: (query: string) => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex h-6 items-center gap-1">
        <h3 className="flex-1 text-caption text-body">{title}</h3>
        {action}
      </div>
      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={placeholder}
        aria-label={searchLabel}
        autoComplete="off"
        spellCheck={false}
        className={SEARCH_CLASS}
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-hairline bg-canvas">
        {children}
      </div>
    </section>
  );
}

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-canvas-soft-2 has-disabled:cursor-default";

function PickerStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-2 py-2 text-caption text-mute">
      {children}
    </p>
  );
}

function LabelPicker({
  root,
  selected,
  disabled,
  onToggle,
}: {
  root: string;
  selected: readonly string[];
  disabled: boolean;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation("issues");
  const labels = useLabels(root);
  const [query, setQuery] = useState("");
  const shown = searchLabels(labels.data ?? [], selected, query);
  return (
    <Picker
      title={t("pickers.labels")}
      placeholder={t("pickers.searchLabels")}
      searchLabel={t("pickers.searchLabelsLabel")}
      query={query}
      onQuery={setQuery}
    >
      {labels.isPending ? (
        <PickerStatus>{t("pickers.loadingLabels")}</PickerStatus>
      ) : labels.isError && selected.length === 0 ? (
        <PickerStatus>{t("pickers.labelsUnavailable")}</PickerStatus>
      ) : shown.length === 0 ? (
        <PickerStatus>{t("pickers.noLabels")}</PickerStatus>
      ) : (
        <ul>
          {shown.map((label) => (
            <li key={label.name}>
              <label title={label.description || label.name} className={ITEM_CLASS}>
                <input
                  type="checkbox"
                  checked={selected.includes(label.name)}
                  disabled={disabled}
                  onChange={() => onToggle(label.name)}
                  className="accent-primary"
                />
                <LabelPill label={label} />
              </label>
            </li>
          ))}
        </ul>
      )}
    </Picker>
  );
}

function AssigneePicker({
  root,
  selected,
  disabled,
  onToggle,
  onAssignMe,
}: {
  root: string;
  selected: readonly string[];
  disabled: boolean;
  onToggle: (login: string) => void;
  onAssignMe: (login: string) => void;
}) {
  const { t } = useTranslation("issues");
  const users = useAssignees(root);
  const me = useCurrentUser(root);
  const [query, setQuery] = useState("");
  const shown = searchLogins(users.data ?? [], selected, query);
  const login = me.data ?? null;
  return (
    <Picker
      title={t("pickers.assignees")}
      placeholder={t("pickers.searchAssignees")}
      searchLabel={t("pickers.searchAssigneesLabel")}
      query={query}
      onQuery={setQuery}
      action={
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled || login === null || selected.includes(login)}
          title={
            login === null ? t("pickers.userUnavailable") : t("pickers.assignMeTitle", { login })
          }
          onClick={() => login !== null && onAssignMe(login)}
        >
          {t("pickers.assignMe")}
        </Button>
      }
    >
      {users.isPending ? (
        <PickerStatus>{t("pickers.loadingPeople")}</PickerStatus>
      ) : users.isError && selected.length === 0 ? (
        <PickerStatus>{t("pickers.peopleUnavailable")}</PickerStatus>
      ) : shown.length === 0 ? (
        <PickerStatus>{t("pickers.noPeople")}</PickerStatus>
      ) : (
        <ul>
          {shown.map((user) => (
            <li key={user}>
              <label className={ITEM_CLASS}>
                <input
                  type="checkbox"
                  checked={selected.includes(user)}
                  disabled={disabled}
                  onChange={() => onToggle(user)}
                  className="accent-primary"
                />
                <span className="truncate text-body-sm text-ink">{user}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Picker>
  );
}
