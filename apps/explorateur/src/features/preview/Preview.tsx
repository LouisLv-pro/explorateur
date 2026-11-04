import {
  Activity,
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { List, LoaderCircle, RotateCw } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { AppError, FilePreview, RootFolder } from "@/bindings";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionsMenu } from "@/features/file-actions/ActionsMenu";
import { CodeEditor } from "@/features/editor/CodeEditor";
import {
  isDirty,
  isTextPreview,
  loadDocument,
  markDeleted,
  setSourceShown,
  useDocument,
  type EditorDoc,
} from "@/features/editor/documents";
import { EditorBanner } from "@/features/editor/EditorBanner";
import { IssuePane } from "@/features/issues/IssuePane";
import { useLastRead } from "@/features/last-read/api";
import { LastReadBanner } from "@/features/last-read/LastReadBanner";
import { ReadDiff } from "@/features/last-read/ReadDiff";
import { ServerPane } from "@/features/servers/ServerPane";
import { entryOfTab, tabKey, type Tab } from "@/features/tabs/tabs";
import { useFileVersion, useVersionUnder } from "@/features/watch/versions";
import { useWorkspace } from "@/features/workspace/context";
import { isAppError } from "@/lib/ipc";
import { previewUrl, relativePath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useFilePreview } from "./api";
import { shortcutHint, type ShortcutAction } from "@/features/shortcuts/shortcuts";
import { useShortcuts } from "@/features/shortcuts/useShortcuts";
import {
  DEFAULT_MODES,
  displayFor,
  hasDisplayModes,
  modeTarget,
  viewKind,
  type DisplayMode,
  type DisplayModes,
} from "./display";
import { dataFormat } from "./data/formats";
import { formatSize } from "./format";
import { ImageView } from "./ImageView";
import { Message } from "./Message";
import { toggleOutlineShown, useOutlineShown } from "./markdown/outline";
import { dataView, markdownView } from "./views";

// Markdown, tableaux et arbres de données : chargés à la demande ou préchargés (`views.ts`).
const MarkdownView = markdownView.Component;
const DataView = dataView.Component;
// Mermaid pèse lourd : chargé à la première ouverture d'un `.mmd`.
const MermaidDiagram = lazy(() =>
  import("./mermaid/MermaidDiagram").then((m) => ({ default: m.MermaidDiagram })),
);

// Les libellés (`preview:modes.<mode>`) se lisent au rendu : ils suivent la langue.
const MODES: [DisplayMode, ShortcutAction][] = [
  ["rendered", "mode-rendered"],
  ["split", "mode-split"],
  ["source", "mode-source"],
];

/** Mode d'affichage de chaque raccourci ⌥⌘1, ⌥⌘2, ⌥⌘3. */
const SHORTCUT_MODES: Partial<Record<ShortcutAction, DisplayMode>> = Object.fromEntries(
  MODES.map(([mode, action]) => [action, mode]),
);

/**
 * Zone d'aperçu : en-tête (chemin, taille, actions) et aperçu de chaque onglet. La barre
 * d'onglets est au-dessus, dans `Shell` : elle couvre aussi le volet Modifications.
 */
export function Preview({
  root,
  hidden = false,
}: {
  root: RootFolder;
  /** Masqué sans être démonté (terminal agrandi) : onglets, éditeurs et défilement restent. */
  hidden?: boolean;
}) {
  const { t } = useTranslation("preview");
  const { tabs, activeTab } = useWorkspace();
  // Un mode d'affichage par type, valable pour tous les fichiers de la session.
  const [modes, setModes] = useState<DisplayModes>(DEFAULT_MODES);
  // Stable : `FilePane` est mémoïsé, ouvrir un onglet ne redessine pas les autres volets.
  const onMode = useCallback(
    (key: keyof DisplayModes, mode: DisplayMode) => setModes((m) => ({ ...m, [key]: mode })),
    [],
  );

  return (
    // `data-preview` : le terminal masqué rend le focus ici.
    <main
      data-preview
      tabIndex={-1}
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden outline-none",
        hidden && "hidden",
      )}
    >
      {tabs.length > 0 ? (
        <>
          {/* Un onglet inactif reste monté, masqué : mode, défilement et taille d'image survivent. */}
          {tabs.map((tab) => (
            <Activity
              key={tab.id ?? tab.path}
              mode={tab.path === activeTab?.path ? "visible" : "hidden"}
            >
              {tab.server !== undefined ? (
                // Inactif, l'iframe reste montée : l'état du site est gardé.
                <ServerPane serverKey={tab.server} />
              ) : tab.issue !== undefined ? (
                <IssuePane rootPath={root.path} tabPath={tab.path} number={tab.issue} />
              ) : (
                <FilePane root={root} tab={tab} modes={modes} onMode={onMode} />
              )}
            </Activity>
          ))}
        </>
      ) : (
        <Message>
          <p>{t("empty.choose")}</p>
          <p className="font-mono text-caption-mono">{t("empty.quickOpen")}</p>
        </Message>
      )}
    </main>
  );
}

type PaneProps = {
  root: RootFolder;
  tab: Tab;
  modes: DisplayModes;
  onMode: (key: keyof DisplayModes, mode: DisplayMode) => void;
};

/** Aperçu d'un fichier. Un volet par onglet, `key={id}` : un renommage garde l'état du volet. */
const FilePane = memo(function FilePane({ root, tab, modes, onMode }: PaneProps) {
  const { t } = useTranslation("preview");
  const entry = entryOfTab(tab);
  const key = tabKey(tab);
  const query = useFilePreview(entry.path);
  const doc = useDocument(key);
  const [imageSize, setImageSize] = useState<[number, number] | null>(null);
  const [reloads, setReloads] = useState(0);

  // Chaque lecture (ouverture, changement disque) passe par le document de l'éditeur, qui
  // décide de remplacer le texte ou d'afficher la bannière de conflit.
  const { data, dataUpdatedAt } = query;
  useEffect(() => {
    if (data && isTextPreview(data)) loadDocument(key, data, dataUpdatedAt);
  }, [key, data, dataUpdatedAt]);
  // Modifié depuis votre dernière lecture : bandeau et diff du volet.
  const lastRead = useLastRead(entry.path, root.path, query.isSuccess, dataUpdatedAt);
  const missing = query.isError && isAppError(query.error) && query.error.kind === "NotFound";
  useEffect(() => {
    if (missing) markDeleted(key);
  }, [key, missing]);

  // Fichier supprimé (ou illisible) avec des modifications : l'éditeur reste, ⌘S le recrée.
  const keepDraft = query.isError && isDirty(doc) && query.data !== undefined;
  // Après une erreur, TanStack garde l'ancien contenu : l'en-tête l'ignore, sauf brouillon gardé.
  const preview = query.isError && !keepDraft ? undefined : query.data;
  const kind = preview ? viewKind(preview) : undefined;
  const mode = kind ? displayFor(kind, modes) : "rendered";

  // Les gestes « depuis la sélection » (menu Actions) lisent l'éditeur : seulement si la source
  // est affichée. Gardé tel quel quand le volet est masqué (`<Activity>`), sans nettoyage.
  const sourceVisible =
    (kind === "Text" || (kind !== undefined && hasDisplayModes(kind) && mode !== "rendered")) &&
    doc !== undefined;
  useEffect(() => {
    setSourceShown(key, sourceVisible);
  }, [key, sourceVisible]);

  // ⌥⌘1, ⌥⌘2, ⌥⌘3 : comme le bouton du mode. Seul le volet visible écoute : `<Activity>`
  // démonte les effets des onglets inactifs.
  // ⌥⌘T : le sommaire d'un Markdown affiché en Aperçu ou en Scindé (rien en Source).
  const outlineAvailable = kind === "Markdown" && mode !== "source";
  const outlineShown = useOutlineShown();
  useShortcuts((action, event) => {
    if (action === "toggle-outline") {
      if (!outlineAvailable) return;
      event.preventDefault();
      toggleOutlineShown();
      return;
    }
    const value = SHORTCUT_MODES[action];
    if (value === undefined || kind === undefined) return;
    const target = modeTarget(kind, value);
    if (target === null) return;
    event.preventDefault();
    onMode(target, value);
  });

  function reload() {
    setReloads((n) => n + 1);
    void query.refetch();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-hairline pr-3 pl-4">
        <FilePath path={relativePath(entry.path, root.path)} />
        <div className="ml-auto flex shrink-0 items-center gap-3 text-body-sm text-mute">
          {imageSize && <span>{`${imageSize[0]} × ${imageSize[1]}`}</span>}
          {preview && <span>{formatSize(preview.size)}</span>}
          {kind !== undefined && (hasDisplayModes(kind) || kind === "LargeHtml") && (
            <div role="group" aria-label={t("header.display")} className="flex gap-0.5">
              {MODES.map(([value, action]) => (
                <ToggleButton
                  key={value}
                  pressed={mode === value}
                  hint={t("header.modeHint", {
                    mode: t(`modes.${value}`),
                    shortcut: shortcutHint(action),
                  })}
                  // Grosse page HTML : seul l'aperçu existe, sa source n'est pas lue.
                  unavailable={
                    kind === "LargeHtml" && value !== "rendered"
                      ? t("sourceUnavailable")
                      : undefined
                  }
                  onPress={() => {
                    // Même cible que le raccourci : Scindé et Source d'une grosse page HTML n'en ont pas.
                    const target = modeTarget(kind, value);
                    if (target !== null) onMode(target, value);
                  }}
                >
                  {t(`modes.${value}`)}
                </ToggleButton>
              ))}
            </div>
          )}
          {outlineAvailable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("outline.title")}
                  aria-pressed={outlineShown}
                  onClick={toggleOutlineShown}
                  className={cn(outlineShown ? "bg-hairline text-ink" : "text-mute")}
                >
                  <List />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("header.outlineHint", { shortcut: shortcutHint("toggle-outline") })}
              </TooltipContent>
            </Tooltip>
          )}
          {(kind === "Html" || kind === "LargeHtml") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("header.reload")}
                  onClick={reload}
                  className="text-mute"
                >
                  <RotateCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("header.reload")}</TooltipContent>
            </Tooltip>
          )}
          <ActionsMenu path={entry.path} />
        </div>
      </header>
      {doc?.banner && <EditorBanner banner={doc.banner} docKey={key} path={entry.path} />}
      {lastRead.notice && (
        <LastReadBanner
          notice={lastRead.notice}
          showDiff={lastRead.showDiff}
          onToggleDiff={lastRead.toggleDiff}
          onDismiss={lastRead.dismiss}
        />
      )}
      {lastRead.notice?.kind === "Changed" && lastRead.showDiff ? (
        <ReadDiff diff={lastRead.notice.diff} name={entry.name} />
      ) : query.isPending ? (
        <Message>
          <DelayedSpinner />
        </Message>
      ) : query.isError && !keepDraft ? (
        <Message>
          <p role="alert">{readErrorMessage(query.error)}</p>
        </Message>
      ) : (
        preview && (
          <Body
            preview={preview}
            docKey={key}
            doc={doc}
            rootPath={root.path}
            mode={mode}
            line={tab.line}
            lineSeq={tab.lineSeq}
            reloads={reloads}
            onImageSize={(w, h) => setImageSize([w, h])}
          />
        )
      )}
    </div>
  );
});

/**
 * Roue de chargement, montrée seulement si la lecture dure : une lecture rapide passe
 * directement au contenu, sans éclair de roue.
 */
function DelayedSpinner() {
  const { t } = useTranslation("preview");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return <LoaderCircle className="size-4 motion-safe:animate-spin" aria-label={t("loading")} />;
}

const SPINNER_DELAY_MS = 150;

/** Chemin relatif : dossiers en `text-mute`, nom du fichier en `text-ink`. */
function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <p className="min-w-0 truncate text-body-sm" title={path}>
      <span className="text-mute">{path.slice(0, slash + 1)}</span>
      <span className="text-ink">{path.slice(slash + 1)}</span>
    </p>
  );
}

function ToggleButton({
  pressed,
  hint,
  unavailable,
  onPress,
  children,
}: {
  pressed: boolean;
  /** Infobulle du bouton actif : le mode et son raccourci. */
  hint: string;
  /** Raison affichée en infobulle quand le bouton est désactivé. */
  unavailable?: string;
  onPress: () => void;
  children: string;
}) {
  const button = (
    <Button
      variant="ghost"
      size="xs"
      aria-pressed={pressed}
      disabled={unavailable !== undefined}
      onClick={onPress}
      className={cn(pressed ? "bg-hairline text-ink" : "text-mute")}
    >
      {children}
    </Button>
  );
  // Un bouton désactivé ne reçoit pas le survol : l'infobulle native est portée par un `span`.
  if (unavailable) return <span title={unavailable}>{button}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Rendu, source ou les deux côte à côte (moitié-moitié, chaque volet défile seul). */
function Modes({
  mode,
  source,
  rendered,
}: {
  mode: DisplayMode;
  source: ReactNode;
  rendered: ReactNode;
}) {
  if (mode === "source") return source;
  if (mode === "rendered") return rendered;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 basis-0 overflow-hidden">{source}</div>
      <div className="flex min-w-0 flex-1 basis-0 overflow-hidden border-l border-hairline">
        {rendered}
      </div>
    </div>
  );
}

function Body({
  preview,
  docKey,
  doc,
  rootPath,
  mode,
  line,
  lineSeq,
  reloads,
  onImageSize,
}: {
  preview: FilePreview;
  /** Document de l'éditeur (fichier texte, Markdown, HTML), créé à la première lecture. */
  docKey: string;
  doc: EditorDoc | undefined;
  rootPath: string;
  mode: DisplayMode;
  line: number | undefined;
  lineSeq: number | undefined;
  reloads: number;
  onImageSize: (width: number, height: number) => void;
}) {
  const { t } = useTranslation("preview");
  const { content, path, name } = preview;
  // Changements du disque (rechargement-auto.md) : l'image ou le PDF changé, ou tout fichier
  // du dossier de la page HTML (CSS, JS, images), change l'URL et recharge l'aperçu.
  const fileVersion = useFileVersion(path);
  const pageVersion = useVersionUnder(path.slice(0, path.lastIndexOf("/")));
  const pageStamp = reloads + pageVersion;
  // Le paramètre force le WebView à relire la page après « Recharger » ; ses ressources ne sont
  // jamais mises en cache par le protocole `preview` (décision 0001).
  const pageUrl =
    previewUrl(convertFileSrc("", "preview"), path) + (pageStamp > 0 ? `?reload=${pageStamp}` : "");
  // Le WebView garde sinon l'ancienne image ou l'ancien PDF en cache.
  const assetUrl = convertFileSrc(path) + (fileVersion > 0 ? `?v=${fileVersion}` : "");
  // Le rendu Markdown suit la frappe, sans la ralentir (rendu différé).
  const markdown = useDeferredValue(doc?.text ?? ("text" in content ? content.text : ""));
  // L'éditeur attend son document, créé par l'effet de `FilePane` juste après la lecture.
  const source = doc ? (
    <CodeEditor docKey={docKey} path={path} name={name} line={line} lineSeq={lineSeq} />
  ) : null;

  switch (content.kind) {
    case "Markdown":
      return (
        <Modes
          mode={mode}
          source={source}
          rendered={
            // MarkdownView porte son défileur : le sommaire se place à côté de la zone qui défile.
            <div className="flex min-h-0 min-w-0 flex-1">
              <Suspense fallback={null}>
                <MarkdownView text={markdown} path={path} rootPath={rootPath} />
              </Suspense>
            </div>
          }
        />
      );
    case "Mermaid":
      // Le diagramme seul, sans la colonne de 760 px du Markdown : toute la largeur.
      return (
        <Modes
          mode={mode}
          source={source}
          rendered={
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              <Suspense fallback={null}>
                <MermaidDiagram source={markdown} className="px-8 py-10" />
              </Suspense>
            </div>
          }
        />
      );
    case "Html":
      // L'`iframe` montre la version enregistrée : elle se recharge après ⌘S (surveillance).
      return (
        <Modes
          mode={mode}
          source={source}
          rendered={<PageFrame stamp={pageStamp} name={name} src={pageUrl} />}
        />
      );
    case "LargeHtml":
      // Plus de 2 Mo : pas de texte, mais l'`iframe` lit la page par le protocole `preview`.
      return <PageFrame stamp={pageStamp} name={name} src={pageUrl} />;
    case "Text": {
      // CSV, TSV, JSON, YAML (docs/specs/apercu-donnees.md) : tableau ou arbre, comme le Markdown.
      const format = dataFormat(name);
      if (format === undefined) return source;
      return (
        <Modes
          mode={mode}
          source={source}
          rendered={
            <Suspense fallback={null}>
              <DataView
                text={markdown}
                format={format}
                mode={mode}
                source={source}
                fileKey={path}
              />
            </Suspense>
          }
        />
      );
    }
    case "Image":
      return (
        <ImageView
          key={path}
          src={assetUrl}
          version={fileVersion}
          name={name}
          onSize={onImageSize}
        />
      );
    case "Pdf":
      // Sans `sandbox` : il bloquerait le lecteur PDF du WebView.
      return <iframe title={name} src={assetUrl} className="min-h-0 w-full flex-1 border-0" />;
    case "TooLarge":
      return (
        <Message>
          <p>{t("tooLarge", { size: formatSize(preview.size) })}</p>
        </Message>
      );
    case "Binary":
      return (
        <Message>
          <p>{t("binary")}</p>
        </Message>
      );
  }
}

/** Page HTML rendue ; `stamp` change à chaque rechargement (manuel ou disque). */
function PageFrame({ stamp, name, src }: { stamp: number; name: string; src: string }) {
  const { t } = useTranslation("preview");
  return (
    // Sans `allow-same-origin` : la page a une origine opaque et ne peut ni appeler les
    // commandes de l'app ni lire son contenu (décision 0001).
    // Fond blanc et schéma clair dans les deux thèmes : la page s'affiche telle qu'un navigateur
    // la montre (spec mode-sombre.md) ; sans fond propre, son texte noir tomberait sur du noir.
    <iframe
      key={stamp}
      title={t("frameTitle", { name })}
      src={src}
      sandbox="allow-scripts"
      className="min-h-0 w-full min-w-0 flex-1 border-0 bg-white scheme-light"
    />
  );
}

/** Message d'une lecture échouée, dans la langue active (appelé au rendu). */
function readErrorMessage(error: unknown): string {
  const kind: AppError["kind"] | undefined = isAppError(error) ? error.kind : undefined;
  switch (kind) {
    case "NotFound":
      return i18n.t("preview:readError.notFound");
    case "PermissionDenied":
      return i18n.t("preview:readError.permissionDenied");
    case "NotAFile":
      return i18n.t("preview:readError.notAFile");
    default:
      return i18n.t("preview:readError.other");
  }
}
