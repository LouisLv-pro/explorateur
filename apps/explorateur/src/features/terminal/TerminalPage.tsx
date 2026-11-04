// Une page du terminal : un xterm relié à un shell Rust. Reste montée quand elle est inactive
// ou le panneau masqué (le shell, le contenu et le défilement survivent).
import { useEffect, useEffectEvent, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AppError } from "@/bindings";
import { Button } from "@/components/ui/button";
import { terminalAction, terminalTakesKey } from "@/features/shortcuts/shortcuts";
import i18n from "@/i18n";
import { appErrorText } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useIssueOpener } from "@/features/issues/open";
import { previewKindOf } from "@/features/quick-open/match";
import { ENTRY_PATH_MIME, carriesEntry } from "@/features/tree/drag";
import { useWorkspace } from "@/features/workspace/context";
import { closeTerminal, resizeTerminal, shellQuote, startTerminal, writeTerminal } from "./api";
import { useTerminalActions } from "./context";
import { publishOutput } from "./output";
import { registerLinkProviders } from "./linkProviders";
import { TerminalSearch } from "./TerminalSearch";
import { TERMINAL_FONT, terminalFontSize, terminalTheme } from "./xtermTheme";

/** Historique de défilement par page (spec). */
const SCROLLBACK = 10_000;
// Commande lancée par l'app : silence qui marque le prompt affiché, et attente maximale.
const PROMPT_QUIET_MS = 200;
const PROMPT_WAIT_MS = 3000;

/** Message d'échec du shell dans la langue active, composé au rendu. */
function startErrorMessage(error: AppError): string {
  switch (error.kind) {
    case "NotFound":
      return i18n.t("terminal:startError.notFound", { detail: error.message });
    case "NotADirectory":
      return i18n.t("terminal:startError.notADirectory", { detail: error.message });
    default:
      return i18n.t("terminal:startError.other", { detail: appErrorText(error) });
  }
}

export function TerminalPage({
  id,
  cwd,
  active,
  shown,
  focusSeq,
  command,
}: {
  id: number;
  cwd: string;
  /**
   * Commande tapée une fois le shell lancé (Lancer un serveur local) : la page s'affiche sans
   * prendre le focus, jusqu'à la prochaine demande de focus.
   */
  command?: string;
  /** Page active du panneau. */
  active: boolean;
  /** Page active et panneau affiché : elle est à l'écran. */
  shown: boolean;
  focusSeq: number;
}) {
  const { t } = useTranslation("terminal");
  const { reportActivity, reportTitle } = useTerminalActions();
  const { root, openFile } = useWorkspace();
  // Lu par les liens fichier au survol : changer de dossier racine ne recrée pas le terminal.
  const rootRef = useRef<string | null>(root?.path ?? null);
  useEffect(() => {
    rootRef.current = root?.path ?? null;
  }, [root]);
  const [search, setSearch] = useState<SearchAddon | null>(null);
  /** 0 : barre de recherche fermée ; incrémenté à chaque ⌘F. */
  const [searchSeq, setSearchSeq] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const activeRef = useRef(active);
  // Lue au lancement du shell seulement : elle ne change pas pendant la vie de la page.
  const commandRef = useRef(command);
  const [error, setError] = useState<AppError | null>(null);
  // « Relancer » recrée le terminal et le shell.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const onOutput = useEffectEvent(() => {
    if (!activeRef.current) reportActivity(id);
  });
  const onTitle = useEffectEvent((title: string) => reportTitle(id, title));
  // ⌘clic sur un lien fichier : onglet épinglé, à la ligne.
  const onOpenFile = useEffectEvent((path: string, line: number | null) => {
    const name = path.split("/").at(-1) ?? path;
    openFile(
      { name, path, is_dir: false, preview_kind: previewKindOf(name) },
      { pin: true, line: line ?? undefined },
    );
  });
  // ⌘clic sur un lien web : l'issue d'un lien `…/issues/N` du même dépôt s'ouvre en onglet.
  const { openIssue, openLink } = useIssueOpener();
  const onOpenUrl = useEffectEvent((url: string) => void openLink(rootRef.current, url));
  const onOpenIssue = useEffectEvent((number: number) => {
    if (rootRef.current !== null) void openIssue(rootRef.current, number);
  });
  // ⌘F : ouvre la barre (ou y remet le focus).
  const openSearch = useEffectEvent(() => setSearchSeq((n) => n + 1));

  /** Entrée de l'arborescence déposée : chemin échappé par Rust, une espace, sans valider. */
  function onDragOver(event: DragEvent) {
    if (!carriesEntry(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function onDrop(event: DragEvent) {
    const path = event.dataTransfer.getData(ENTRY_PATH_MIME);
    if (path === "") return;
    event.preventDefault();
    void shellQuote(path).then((quoted) => {
      writeTerminal(id, `${quoted} `);
      termRef.current?.focus();
    });
  }

  function closeSearch() {
    search?.clearDecorations();
    setSearchSeq(0);
    termRef.current?.focus();
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    let promptTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: terminalFontSize(),
      scrollback: SCROLLBACK,
      // ⌥ reste la touche de caractères (AZERTY : | { [ ~), jamais Méta.
      macOptionIsMeta: false,
      cursorBlink: true,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    setSearch(searchAddon);
    termRef.current = term;
    const links = registerLinkProviders(term, {
      context: () => ({ cwd, root: rootRef.current }),
      openUrl: (url) => onOpenUrl(url),
      openFile: (path, line) => onOpenFile(path, line),
      openIssue: (number) => onOpenIssue(number),
    });

    // Les touches avec ⌘ et les raccourcis du terminal reviennent à l'app (le shell ne les voit
    // pas) ; ⌘C et ⌘V restent les événements copier / coller natifs, que xterm traite.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.metaKey && !event.shiftKey && !event.altKey) {
        if (event.key.toLowerCase() === "a") {
          event.preventDefault();
          term.selectAll();
          return false;
        }
        if (terminalAction(event, { inTerminal: true }) === "terminal-clear") {
          event.preventDefault();
          term.clear();
          return false;
        }
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          openSearch();
          return false;
        }
      }
      return !terminalTakesKey(event);
    });
    term.onData((data) => writeTerminal(id, data));
    term.onTitleChange((title) => onTitle(title));
    term.onResize(({ cols, rows }) => resizeTerminal(id, cols, rows));

    // ⌘A passe par le menu natif « Tout sélectionner », qui sélectionne le texte caché d'xterm :
    // on sélectionne le terminal à la place. Le clic droit d'xterm sélectionne aussi ce texte
    // (pour le menu contextuel) : ignoré juste après un clic droit.
    let lastRightClick = 0;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) lastRightClick = Date.now();
    };
    const onSelectAll = () => {
      if (Date.now() - lastRightClick > 500) term.selectAll();
    };
    host.addEventListener("mousedown", onMouseDown, true);

    const refit = () => {
      if (!live || host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(refit));

    // Couleurs : relues quand la classe `dark` de <html> change (⇧⌘L, thème du système).
    const themeObserver = new MutationObserver(() => {
      term.options.theme = terminalTheme();
    });

    // La police doit être chargée avant qu'xterm mesure la largeur d'un caractère.
    const fontReady = document.fonts
      .load(`${terminalFontSize()}px "Geist Mono Variable"`)
      .catch(() => []);
    void fontReady.then(async () => {
      if (!live) return;
      term.open(host);
      term.textarea?.addEventListener("select", onSelectAll);
      refit();
      observer.observe(host);
      themeObserver.observe(document.documentElement, { attributeFilter: ["class"] });
      // Commande lancée par l'app : tapée comme par l'utilisateur, suivie de ↵ (le shell reste
      // après son arrêt), une fois le prompt affiché. Tapée plus tôt, le terminal l'écho une
      // première fois avant que le shell la réaffiche après son prompt.
      const typeCommand = () => {
        clearTimeout(promptTimer);
        clearTimeout(fallbackTimer);
        if (!live || commandRef.current === undefined) return;
        writeTerminal(id, `${commandRef.current}\r`);
        commandRef.current = undefined;
      };
      const failure = await startTerminal(
        id,
        cwd,
        { cols: term.cols, rows: term.rows },
        (bytes) => {
          if (!live) return;
          term.write(bytes);
          publishOutput(id, bytes);
          onOutput();
          // Prompt affiché = sortie suivie d'un silence.
          if (commandRef.current !== undefined) {
            clearTimeout(promptTimer);
            promptTimer = setTimeout(typeCommand, PROMPT_QUIET_MS);
          }
        },
      );
      if (!live) return;
      setError(failure);
      if (failure !== null) return;
      if (commandRef.current !== undefined) fallbackTimer = setTimeout(typeCommand, PROMPT_WAIT_MS);
      else if (activeRef.current) term.focus();
    });

    return () => {
      live = false;
      clearTimeout(promptTimer);
      clearTimeout(fallbackTimer);
      observer.disconnect();
      themeObserver.disconnect();
      term.textarea?.removeEventListener("select", onSelectAll);
      host.removeEventListener("mousedown", onMouseDown, true);
      closeTerminal(id);
      links.dispose();
      term.dispose();
      termRef.current = null;
      setSearch(null);
      setSearchSeq(0);
    };
  }, [id, cwd, attempt]);

  // Focus demandé (panneau affiché, page activée ou créée) : après le rendu qui l'affiche.
  // Page d'une commande lancée par l'app : pas de focus avant une nouvelle demande.
  const quietSeq = useRef(command === undefined ? null : focusSeq);
  useEffect(() => {
    if (!shown || focusSeq === quietSeq.current) return;
    quietSeq.current = null;
    const frame = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [shown, focusSeq]);

  return (
    <div
      className={cn("relative min-h-0 flex-1", !active && "hidden")}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Marges hors de l'élément mesuré : `fit` lit la taille de son parent sans ses marges. */}
      <div className="absolute inset-0 py-1 pl-3">
        <div ref={hostRef} className="size-full" />
      </div>
      {search !== null && searchSeq > 0 && (
        <TerminalSearch search={search} focusSeq={searchSeq} onClose={closeSearch} />
      )}
      {error !== null && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-start gap-3 bg-canvas px-4 py-3"
        >
          <p className="font-mono text-code text-error">{startErrorMessage(error)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw />
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
