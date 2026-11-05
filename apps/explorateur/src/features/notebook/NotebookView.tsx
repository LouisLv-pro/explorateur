// Vue notebook (docs/specs/notebook.md) : barre d'outils (environnement, état du noyau, actions),
// cellules de code, Markdown et brutes, sorties. Le modèle vit dans le document de l'onglet
// (`documents.ts`), le noyau dans `kernel.ts` : les deux survivent au masquage de l'onglet.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eraser,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { commands, type PythonEnv } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { editNotebook, notebookOf, useNotebook } from "@/features/editor/documents";
import { Invalid } from "@/features/preview/Invalid";
import { appErrorMessage } from "@/i18n/errors";
import { isAppError, unwrap } from "@/lib/ipc";
import { AnsiText } from "./AnsiText";
import { CellEditor } from "./CellEditor";
import { HtmlOutput, MarkdownBlock } from "./HtmlOutput";
import {
  addCell,
  cellSource,
  cellType,
  changeCellType,
  clearAllOutputs,
  moveCell,
  removeCell,
  setSource,
  type Cell,
  type CellType,
  type Json,
  type NotebookModel,
} from "./model";
import {
  chooseEnv,
  chosenEnv,
  interruptKernel,
  restartKernel,
  runCells,
  useKernel,
} from "./kernel";
import { displayOutputs, type DisplayOutput } from "./outputs";
import "./notebook.css";

type Props = {
  /** Clé du document (`tabKey`). */
  docKey: string;
  path: string;
  rootPath: string;
  /** Éditeur de la source, montré sous la bannière d'un notebook invalide. */
  source: ReactNode;
};

/** Commandes à copier quand aucun Python n'a `ipykernel`. */
const INSTALL_COMMANDS = [
  "python3 -m pip install ipykernel",
  "python3 -m venv .venv && .venv/bin/pip install ipykernel",
];

/** Au-delà, la sortie défile dans une zone de hauteur bornée. */
const LONG_OUTPUT_LINES = 400;

const isObject = (value: Json | undefined): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function metadataName(model: NotebookModel, field: "kernelspec" | "language_info") {
  const metadata = model.json.metadata;
  const entry = isObject(metadata) ? metadata[field] : undefined;
  const name = isObject(entry) ? entry.name : undefined;
  return typeof name === "string" ? name : undefined;
}

/**
 * Environnement retenu : le choix mémorisé s'il est encore utilisable, sinon le kernelspec nommé
 * dans le notebook, sinon le premier Python avec `ipykernel`.
 */
function pickEnv(
  envs: PythonEnv[],
  choice: string | undefined,
  kernelName: string | undefined,
): string | undefined {
  const usable = envs.filter((env) => env.hasIpykernel);
  if (choice && usable.some((env) => env.id === choice)) return choice;
  const named =
    kernelName === undefined
      ? undefined
      : usable.find((env) => env.kind === "Kernelspec" && env.id.split("/").pop() === kernelName);
  return (named ?? usable[0])?.id;
}

export function NotebookView({ docKey, path, source }: Props) {
  const { t } = useTranslation("notebook");
  const parsed = useNotebook(docKey);
  if (!parsed) return null;
  if (!parsed.ok) {
    const message = parsed.error.kind === "json" ? parsed.error.message : t("notV4");
    return <Invalid message={t("invalid", { message })} mode="rendered" source={source} />;
  }
  return <Notebook docKey={docKey} path={path} model={parsed.model} />;
}

/** Cellule rejointe au clavier : son éditeur prend le focus (`seq` change à chaque geste). */
type Focus = { key: string; seq: number };

function Notebook({ docKey, path, model }: { docKey: string; path: string; model: NotebookModel }) {
  const { t } = useTranslation("notebook");
  const kernel = useKernel(docKey);
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ key: "", seq: 0 });

  // Chaque sonde lance un Python trouvé sur le disque : la liste n'est demandée que sur un geste
  // (ouverture du sélecteur, « Rechercher à nouveau », premier « Exécuter »), jamais à
  // l'ouverture du notebook.
  const queryClient = useQueryClient();
  const envsQuery = useMemo(
    () => ({
      queryKey: ["python_envs", path],
      queryFn: async () => unwrap(await commands.listPythonEnvs(path)),
      staleTime: Infinity,
    }),
    [path],
  );
  const envs = useQuery({ ...envsQuery, enabled: false });
  const [choice, setChoice] = useState(() => chosenEnv(path));
  const kernelName = metadataName(model, "kernelspec");
  const envId = envs.data ? pickEnv(envs.data, choice, kernelName) : undefined;
  const languageName = metadataName(model, "language_info") ?? "python";

  // Gestes des cellules : stables (les cellules sont mémoïsées), ils lisent l'état courant.
  const latest = useRef({ choice, kernelName });
  useEffect(() => {
    latest.current = { choice, kernelName };
  });
  /** Environnement à utiliser : la liste est cherchée au premier geste, puis gardée. */
  const resolveEnv = useCallback(async (): Promise<string | undefined> => {
    try {
      const list = await queryClient.fetchQuery(envsQuery);
      return pickEnv(list, latest.current.choice, latest.current.kernelName);
    } catch {
      // Échec affiché par la requête (bandeau sous la barre d'outils).
      return undefined;
    }
  }, [queryClient, envsQuery]);
  const runWithEnv = useCallback(
    async (keys: string[]) => {
      const env = await resolveEnv();
      if (env) await runCells(docKey, path, env, keys);
    },
    [resolveEnv, docKey, path],
  );
  const restart = useCallback(async () => {
    const env = await resolveEnv();
    if (env) await restartKernel(docKey, path, env);
  }, [resolveEnv, docKey, path]);

  const actions = useMemo<CellActions>(() => {
    const run = (key: string) => void runWithEnv([key]);
    const focusCell = (key: string) => {
      setActive(key);
      setFocus((f) => ({ key, seq: f.seq + 1 }));
    };
    return {
      activate: setActive,
      edit: setEditing,
      run,
      runAndAdvance(key) {
        const current = notebookOf(docKey);
        if (!current?.ok) return;
        const cells = current.model.cells;
        const index = cells.findIndex((c) => c.key === key);
        if (index < 0) return;
        const cell = cells[index]!;
        if (cellType(cell) === "code") run(key);
        setEditing((e) => (e === key ? null : e));
        // Dernière cellule : une cellule de code est créée à la suite.
        if (index === cells.length - 1) editNotebook(docKey, (m) => addCell(m, index + 1, "code"));
        const next = notebookOf(docKey);
        const nextKey = next?.ok ? next.model.cells[index + 1]?.key : undefined;
        if (nextKey) focusCell(nextKey);
      },
      setText(key, text) {
        editNotebook(docKey, (m) => setSource(m, key, text));
      },
      move(key, delta) {
        editNotebook(docKey, (m) => moveCell(m, key, delta));
      },
      remove(key) {
        editNotebook(docKey, (m) => removeCell(m, key));
      },
      retype(key, type) {
        editNotebook(docKey, (m) => changeCellType(m, key, type));
      },
      add(index, type) {
        editNotebook(docKey, (m) => addCell(m, index, type));
        const next = notebookOf(docKey);
        const key = next?.ok ? next.model.cells[index]?.key : undefined;
        if (!key) return;
        if (type === "markdown") setEditing(key);
        focusCell(key);
      },
    };
  }, [docKey, runWithEnv]);

  const codeKeys = model.cells.filter((c) => cellType(c) === "code").map((c) => c.key);
  /** Liste déjà cherchée, sans aucun Python avec `ipykernel`. */
  const noEnv = envs.data !== undefined && envId === undefined;
  const busy = kernel.status === "busy";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        aria-label={t("toolbar")}
        className="flex h-10 shrink-0 items-center gap-3 border-b border-hairline pr-3 pl-4"
      >
        <EnvPicker
          envs={envs.data}
          loading={envs.isFetching}
          envId={envId}
          placeholder={kernelName ?? t("env")}
          onOpen={() => void envs.refetch()}
          onChoose={(id) => {
            chooseEnv(docKey, path, id);
            setChoice(id);
          }}
        />
        <span className="text-body-sm text-mute" aria-live="polite">
          {t(`status.${kernel.status}`)}
        </span>
        {kernel.error && (
          <span className="min-w-0 truncate text-body-sm text-error-deep">
            {appErrorMessage(kernel.error)}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={noEnv || codeKeys.length === 0}
            onClick={() => void runWithEnv(codeKeys)}
          >
            <Play aria-hidden />
            {t("runAll")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!busy}
            onClick={() => void interruptKernel(docKey)}
          >
            <Square aria-hidden />
            {t("interrupt")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={kernel.status === "none"}
            onClick={() => void restart()}
          >
            <RotateCw aria-hidden />
            {t("restart")}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => editNotebook(docKey, clearAllOutputs)}>
            <Eraser aria-hidden />
            {t("clearOutputs")}
          </Button>
        </div>
      </div>
      {noEnv && <NoPython onSearch={() => void envs.refetch()} searching={envs.isFetching} />}
      {envs.isError && (
        <div className="shrink-0 border-b border-hairline bg-warning-soft px-4 py-1.5 text-body-sm text-ink">
          {isAppError(envs.error) ? appErrorMessage(envs.error) : String(envs.error)}
        </div>
      )}
      {kernel.status === "dead" && kernel.died !== null && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-hairline bg-warning-soft py-1.5 pr-3 pl-4 text-body-sm text-ink"
        >
          <span className="min-w-0 flex-1">{t("died")}</span>
          <Button variant="ghost" size="xs" disabled={noEnv} onClick={() => void restart()}>
            {t("restart")}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-240 flex-col px-6 py-6">
          {model.cells.length === 0 && (
            <p className="py-6 text-center text-body-sm text-mute">{t("empty")}</p>
          )}
          {model.cells.map((cell, index) => (
            <div key={cell.key} className="flex flex-col">
              <AddBar index={index} onAdd={actions.add} />
              <CellView
                cell={cell}
                index={index}
                last={index === model.cells.length - 1}
                active={active === cell.key}
                editing={editing === cell.key}
                focusSeq={focus.key === cell.key ? focus.seq : 0}
                languageName={languageName}
                canRun={!noEnv}
                actions={actions}
              />
            </div>
          ))}
          <AddBar index={model.cells.length} onAdd={actions.add} visible />
        </div>
      </div>
    </div>
  );
}

/** Sélecteur d'environnement : chaque ouverture relance la recherche des Python (`onOpen`). */
function EnvPicker({
  envs,
  loading,
  envId,
  placeholder,
  onOpen,
  onChoose,
}: {
  envs: PythonEnv[] | undefined;
  loading: boolean;
  envId: string | undefined;
  placeholder: string;
  onOpen: () => void;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation("notebook");
  return (
    <Select
      value={envId ?? ""}
      onValueChange={onChoose}
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <SelectTrigger size="sm" aria-label={t("env")} className="max-w-64 text-body-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {envs?.map((env) => (
          <SelectItem key={env.id} value={env.id} disabled={!env.hasIpykernel}>
            {env.label}
          </SelectItem>
        ))}
        {(loading || !envs?.length) && (
          <p className="px-2 py-1.5 text-body-sm text-mute">
            {loading ? t("envLoading") : t("noEnv")}
          </p>
        )}
      </SelectContent>
    </Select>
  );
}

/** Aucun Python avec `ipykernel` : les commandes d'installation, à copier. */
function NoPython({ onSearch, searching }: { onSearch: () => void; searching: boolean }) {
  const { t } = useTranslation("notebook");
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-hairline bg-warning-soft px-4 py-2 text-body-sm text-ink">
      <div className="flex items-center gap-3">
        <span className="font-medium">{t("noEnv")}</span>
        <Button variant="ghost" size="xs" disabled={searching} onClick={onSearch}>
          {t("searchAgain")}
        </Button>
      </div>
      <span>{t("installHint")}</span>
      {INSTALL_COMMANDS.map((command) => (
        <CopyLine key={command} text={command} />
      ))}
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const { t } = useTranslation("notebook");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Presse-papiers refusé : pas de retour « Copié ».
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 truncate rounded-sm bg-canvas px-2 py-0.5 font-mono text-code text-ink">
        {text}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? t("copied") : t("copy")}
        onClick={() => void copy()}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}

/** « + Code » et « + Markdown » : entre deux cellules au survol, toujours en fin de notebook. */
function AddBar({
  index,
  onAdd,
  visible = false,
}: {
  index: number;
  onAdd: (index: number, type: CellType) => void;
  visible?: boolean;
}) {
  const { t } = useTranslation("notebook");
  return (
    <div
      className={cn(
        "flex h-7 items-center justify-center gap-1 transition-opacity motion-reduce:transition-none",
        !visible && "opacity-0 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <Button variant="ghost" size="xs" className="text-mute" onClick={() => onAdd(index, "code")}>
        {t("add.code")}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="text-mute"
        onClick={() => onAdd(index, "markdown")}
      >
        {t("add.markdown")}
      </Button>
    </div>
  );
}

type CellActions = {
  activate: (key: string) => void;
  edit: (key: string | null) => void;
  run: (key: string) => void;
  runAndAdvance: (key: string) => void;
  setText: (key: string, text: string) => void;
  move: (key: string, delta: -1 | 1) => void;
  remove: (key: string) => void;
  retype: (key: string, type: CellType) => void;
  add: (index: number, type: CellType) => void;
};

function counterText(cell: Cell): string {
  if (cell.running) return "[*]";
  const count = cell.json.execution_count;
  return typeof count === "number" ? `[${count}]` : "[ ]";
}

const CellView = memo(function CellView({
  cell,
  index,
  last,
  active,
  editing,
  focusSeq,
  languageName,
  canRun,
  actions,
}: {
  cell: Cell;
  index: number;
  last: boolean;
  active: boolean;
  editing: boolean;
  focusSeq: number;
  languageName: string;
  canRun: boolean;
  actions: CellActions;
}) {
  const { t } = useTranslation("notebook");
  const type = cellType(cell);
  const text = cellSource(cell);
  const renderedRef = useRef<HTMLDivElement>(null);
  const showEditor = type !== "markdown" || editing;

  // Cellule Markdown rendue rejointe au clavier : le focus va sur son rendu.
  useEffect(() => {
    if (focusSeq && !showEditor) renderedRef.current?.focus();
  }, [focusSeq, showEditor]);

  // Touches lues avant CodeMirror (`event.key` : indépendant de la disposition du clavier).
  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      actions.runAndAdvance(cell.key);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (type === "code") actions.run(cell.key);
      else actions.edit(null);
    } else if (event.key === "Escape" && showEditor) {
      event.preventDefault();
      event.stopPropagation();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      actions.edit(null);
    }
  }

  const label = t(`cell.${type}`);

  return (
    <div
      data-cell-id={cell.key}
      data-active={active}
      onKeyDownCapture={onKeyDownCapture}
      onFocusCapture={() => actions.activate(cell.key)}
      onMouseDown={() => actions.activate(cell.key)}
      className="group/cell relative flex gap-2 rounded-md border border-transparent py-2 pr-2 data-[active=true]:border-hairline-strong"
    >
      <div className="w-12 shrink-0 pt-2 text-right font-mono text-code text-mute select-none">
        {type === "code" && <span data-counter>{counterText(cell)}</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {showEditor ? (
          <CellEditor
            value={text}
            onChange={(value) => actions.setText(cell.key, value)}
            label={label}
            languageName={
              type === "code" ? languageName : type === "markdown" ? "markdown" : undefined
            }
            wrap={type !== "code"}
            focusSeq={focusSeq}
            // L'éditeur Markdown n'existe que pendant l'édition : il prend le focus à l'ouverture.
            autoFocus={type === "markdown"}
            onBlur={type === "markdown" ? () => actions.edit(null) : undefined}
          />
        ) : (
          <div
            ref={renderedRef}
            tabIndex={0}
            role="button"
            aria-label={label}
            onDoubleClick={() => actions.edit(cell.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                actions.edit(cell.key);
              }
            }}
            className="min-h-9 cursor-text rounded-sm px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {text.trim() === "" ? (
              <p className="text-body-sm text-mute">{t("cell.emptyMarkdown")}</p>
            ) : (
              <MarkdownBlock text={text} />
            )}
          </div>
        )}
        {type === "code" && Array.isArray(cell.json.outputs) && (
          <Outputs outputs={cell.json.outputs} />
        )}
      </div>
      <div
        className={cn(
          "absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-sm border border-hairline bg-canvas shadow-level-1",
          !active && "invisible group-focus-within/cell:visible group-hover/cell:visible",
        )}
      >
        {type === "code" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("cell.run")}
            title={t("cell.run")}
            disabled={!canRun}
            onClick={() => actions.run(cell.key)}
          >
            <Play aria-hidden />
          </Button>
        )}
        {active && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("cell.moveUp")}
              title={t("cell.moveUp")}
              disabled={index === 0}
              onClick={() => actions.move(cell.key, -1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("cell.moveDown")}
              title={t("cell.moveDown")}
              disabled={last}
              onClick={() => actions.move(cell.key, 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            {type !== "code" && (
              <Button variant="ghost" size="xs" onClick={() => actions.retype(cell.key, "code")}>
                {t("cell.toCode")}
              </Button>
            )}
            {type !== "markdown" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => actions.retype(cell.key, "markdown")}
              >
                {t("cell.toMarkdown")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("cell.remove")}
              title={t("cell.remove")}
              onClick={() => actions.remove(cell.key)}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

function lineCount(output: DisplayOutput): number {
  const text =
    output.kind === "stream"
      ? output.text
      : output.kind === "error"
        ? output.traceback.join("\n")
        : output.format.mime === null || output.format.mime.startsWith("image/")
          ? ""
          : output.format.text;
  let lines = 1;
  for (const char of text) if (char === "\n") lines += 1;
  return lines;
}

function Outputs({ outputs }: { outputs: Json[] }) {
  const shown = useMemo(() => displayOutputs(outputs), [outputs]);
  if (shown.length === 0) return null;
  const long = shown.reduce((sum, output) => sum + lineCount(output), 0) > LONG_OUTPUT_LINES;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", long && "max-h-150 overflow-auto")}>
      {shown.map((output, index) => (
        // Les sorties ne font que s'ajouter ou se vider : l'index suffit comme clé.
        <OutputView key={index} output={output} />
      ))}
    </div>
  );
}

const PRE = "px-3 py-1 font-mono text-code break-words whitespace-pre-wrap";

function OutputView({ output }: { output: DisplayOutput }) {
  const { t } = useTranslation("notebook");
  if (output.kind === "stream") {
    return (
      <pre
        className={cn(PRE, "text-ink", output.name === "stderr" && "rounded-sm bg-warning-soft")}
      >
        {output.text}
      </pre>
    );
  }
  if (output.kind === "error") {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-3 font-mono text-code text-syntax-tag">
          <span className="font-semibold">{output.ename}</span>
          {output.evalue && `: ${output.evalue}`}
        </div>
        {output.traceback.length > 0 && (
          <pre className={cn(PRE, "text-ink")}>
            <AnsiText text={output.traceback.join("\n")} />
          </pre>
        )}
      </div>
    );
  }
  const format = output.format;
  switch (format.mime) {
    case null:
      return (
        <p className="px-3 text-body-sm text-mute">
          {t("output.unknown", { mime: format.unknown })}
        </p>
      );
    // Images souvent transparentes, dessinées pour une page blanche : fond `output-surface`,
    // blanc dans les deux thèmes (DESIGN.md).
    case "image/png":
    case "image/jpeg":
      return (
        <img
          src={`data:${format.mime};base64,${format.text.replace(/\s/g, "")}`}
          alt={t("output.image")}
          className="max-w-full self-start rounded-sm bg-output-surface"
        />
      );
    case "image/svg+xml":
      // Dans un `img`, un SVG n'exécute aucun script.
      return (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(format.text)}`}
          alt={t("output.image")}
          className="max-w-full self-start rounded-sm bg-output-surface"
        />
      );
    case "text/html":
      return <HtmlOutput html={format.text} />;
    case "text/markdown":
      return <MarkdownBlock text={format.text} />;
    case "text/plain":
      return (
        <pre className={cn(PRE, "text-ink")}>
          <AnsiText text={format.text} />
        </pre>
      );
  }
}
