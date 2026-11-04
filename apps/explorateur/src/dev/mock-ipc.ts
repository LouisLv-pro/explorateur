// Hors de Tauri (navigateur, playwright-cli), simule les commandes Rust appelées par le front.
// Ajoute une entrée par commande, avec des données réalistes et les cas d'erreur utiles.
// Le faux disque et ses règles vivent dans mock-disk.ts.
import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
  events,
  type AppError,
  type AppTarget,
  type CommitOptions,
  type DiskChange,
  type FileChange,
  type Hunk,
  type IssueFilter,
  type NewIssue,
  type RecentFolder,
  type RootFolder,
} from "@/bindings";
import {
  COMMANDES_ROOT,
  DEMO_ROOT,
  FLUTTER_ROOT,
  HOME,
  MOBILE_ROOT,
  createFakeEntry,
  findFakeFiles,
  findNode,
  listFakeDirectory,
  openFakeFile,
  removeFakeNode,
  renameFakeEntry,
  saveFakeFile,
  searchFakeContent,
  WEB_ROOT,
  writeFakeFile,
} from "./mock-disk";
import {
  createFakeGithubIssue,
  getFakeGithubIssue,
  getFakeGithubRepo,
  getFakeGithubUser,
  listFakeGithubAssignees,
  listFakeGithubIssues,
  listFakeGithubLabels,
  listFakeIssueTemplates,
  setFakeGithub,
  setFakeTemplates,
} from "./mock-github";
import {
  detectFakeApps,
  fakeAppCommand,
  fakeFlutterCommand,
  listFakeAndroidDevices,
  listFakeFlutterDevices,
  listFakeSimulators,
  setFakeAndroidSdk,
  setFakeFlutter,
  setFakeFlutterDevices,
  setFakeXcode,
} from "./mock-apps";
import { detectFakeServers, isFakePortOpen } from "./mock-servers";
import {
  fakeCommit,
  fakeDiscardFile,
  fakeDiscardHunk,
  fakeLastCommitMessage,
  fakeStageAll,
  fakeStageFile,
  fakeStageHunk,
  fakeUnstageAll,
  fakeUnstageFile,
  fakeUnstageHunk,
  fakeGutterBlocks,
  getFakeFileLinkInfo,
  getFakeGitDiff,
  getFakeGitSnapshot,
  getFakeHiddenLines,
  getFakeIndexText,
  isFakeRepo,
  setFakeGitState,
} from "./mock-git";
import {
  advanceFakeRemote,
  failFakeRemote,
  fakeFetch,
  fakePull,
  fakePush,
  fakeRemoteCalls,
  getFakeRemoteState,
  setFakeRemote,
} from "./mock-remote";
import { browserHandlers, browserTools } from "./mock-browser";
import { fakeReadMarks, markFakeRead, noteFakeChanges, setFakeReadRoot } from "./mock-last-read";
import { fakeFinderOpen, fakeOpenLink, queueFromUrl, takeFakeOpened } from "./mock-finder";
import { mockRunningCommands, terminalHandlers } from "./mock-shell";
import { defaultAppHandlers, mockDefaultApp } from "./mock-default-app";

type Handler = (args: Record<string, unknown>) => unknown;

function fail(error: AppError): never {
  throw error;
}

const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? "/";

/** Récents, du plus récent au plus ancien : le projet d'exemple et un dossier disparu. */
let recents: string[] = [
  DEMO_ROOT,
  WEB_ROOT,
  COMMANDES_ROOT,
  MOBILE_ROOT,
  FLUTTER_ROOT,
  `${HOME}/Projets/ancien-site`,
];

function toRecent(path: string): RecentFolder {
  return { path, name: nameOf(path), exists: findNode(path)?.kind === "dir" };
}

/** Même contrat que `folders::open_root` en Rust (sans liens symboliques sur le faux disque). */
function openRoot(path: string): RootFolder {
  if (!path.startsWith("/")) fail({ kind: "NotFound", message: path });
  const node = findNode(path);
  if (!node) fail({ kind: "NotFound", message: path });
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: path });
  if (node.denied) fail({ kind: "PermissionDenied", message: path });
  const normalized = "/" + path.split("/").filter(Boolean).join("/");
  recents = [normalized, ...recents.filter((p) => p !== normalized)].slice(0, 10);
  return { path: normalized, name: nameOf(normalized) };
}

/** Dernier état signalé par `set_unsaved_changes`. */
let unsaved = false;

function emitLater(change: DiskChange) {
  if (change.files.length === 0 && change.dirs.length === 0) return;
  noteFakeChanges(change.files);
  setTimeout(() => void events.diskChanged.emit(change), 200);
}

/** `DiskChanged` d'un autre outil (`__mockDisk`), pastilles mises à jour avant, comme Rust. */
function emitNow(change: DiskChange) {
  noteFakeChanges(change.files);
  void events.diskChanged.emit(change);
}

function ensureFakeExists(path: string) {
  if (!findNode(path)) fail({ kind: "NotFound", message: path });
}

const handlers: Record<string, Handler> = {
  // Terminal : faux shell (ls, pwd, sleep, exit), voir mock-shell.ts.
  ...terminalHandlers,
  // Navigateur intégré : pas de webview, voir mock-browser.ts.
  ...browserHandlers,
  // App par défaut : voir mock-default-app.ts.
  ...defaultAppHandlers,
  open_root: (args) => openRoot(args.path as string),
  list_recent_folders: () => recents.map(toRecent),
  remove_recent_folder: (args) => {
    recents = recents.filter((p) => p !== args.path);
    return null;
  },
  last_root: () => {
    const found = recents.map(toRecent).find((r) => r.exists);
    return found ? { path: found.path, name: found.name } : null;
  },
  // Ouvrir depuis le Finder ou un lien : file remplie par `window.__mockFinder.open` /
  // `openLink`, ou `?finder=<chemin>` / `?link=<url>`.
  take_opened_paths: (args) => takeFakeOpened((args.currentRoot as string | null) ?? null),
  list_directory: (args) => listFakeDirectory(args.path as string, args.showHidden as boolean),
  open_file: (args) => openFakeFile(args.path as string),
  find_files: (args) =>
    findFakeFiles(args.root as string, args.query as string, args.showHidden as boolean),
  search_content: (args) =>
    searchFakeContent(
      args.root as string,
      args.query as string,
      args.caseSensitive as boolean,
      args.showHidden as boolean,
    ),
  // Surveillance : le faux disque émet `disk-changed` à chaque `window.__mockDisk.write/remove`,
  // que le dossier soit « surveillé » ou non ; on garde seulement la racine pour la trace.
  watch_root: (args) => {
    const node = findNode(args.path as string);
    if (!node) fail({ kind: "NotFound", message: args.path as string });
    if (node.kind !== "dir") fail({ kind: "NotADirectory", message: args.path as string });
    console.info("[mock] watch_root", args.path);
    setFakeReadRoot(args.path as string);
    return null;
  },
  // Modifié depuis votre dernière lecture : voir mock-last-read.ts.
  mark_read: (args) => markFakeRead(args.path as string),
  get_read_marks: (args) => fakeReadMarks(args.root as string),
  unwatch_root: () => {
    console.info("[mock] unwatch_root");
    return null;
  },
  // Actions fichier : le navigateur simulé n'ouvre rien, il garde la trace (comme `ensure_exists`,
  // un chemin absent du faux disque donne `NotFound`).
  reveal_in_finder: (args) => {
    ensureFakeExists(args.path as string);
    console.info("[mock] reveal_in_finder", args.path);
    return null;
  },
  open_with_default_app: (args) => {
    ensureFakeExists(args.path as string);
    console.info("[mock] open_with_default_app", args.path);
    return null;
  },
  // Écriture : le faux disque change, puis `DiskChanged` part après 200 ms comme le regroupement
  // du vrai watcher (le front a déjà relu la liste par invalidation directe).
  create_file: (args) => {
    const { path, change } = createFakeEntry(args.dir as string, args.name as string, "file");
    emitLater(change);
    return path;
  },
  create_dir: (args) => {
    const { path, change } = createFakeEntry(args.dir as string, args.name as string, "dir");
    emitLater(change);
    return path;
  },
  rename_entry: (args) => {
    const { path, change } = renameFakeEntry(args.path as string, args.newName as string);
    emitLater(change);
    return path;
  },
  move_to_trash: (args) => {
    emitLater(removeFakeNode(args.path as string));
    return null;
  },
  save_file: (args) => {
    const { revision, change } = saveFakeFile(
      args.path as string,
      args.text as string,
      args.revision as string,
    );
    emitLater(change);
    return revision;
  },
  // Sortie de l'app : le navigateur simulé garde la trace (`__mockMenu.quit()` la demande).
  set_unsaved_changes: (args) => {
    unsaved = args.unsaved as boolean;
    return null;
  },
  quit_app: () => {
    console.info("[mock] quit_app");
    return null;
  },
  // Langue du menu natif : pas de menu dans le navigateur simulé.
  set_language: (args) => {
    console.info("[mock] set_language", args.lang);
    return null;
  },
  // Git : faux dépôt en mémoire, voir mock-git.ts. Annuler écrit le faux disque : `DiskChanged`
  // part après 200 ms, comme le vrai watcher.
  get_git_status: (args) => getFakeGitSnapshot(args.root as string),
  get_git_diff: (args) => getFakeGitDiff(args.change as FileChange),
  get_git_hidden_lines: (args) => getFakeHiddenLines(args.change as FileChange, args.gap as number),
  git_stage_file: (args) => {
    fakeStageFile(args.change as FileChange);
    return null;
  },
  git_unstage_file: (args) => {
    fakeUnstageFile(args.change as FileChange);
    return null;
  },
  git_stage_all: () => {
    fakeStageAll();
    return null;
  },
  git_unstage_all: () => {
    fakeUnstageAll();
    return null;
  },
  git_stage_hunk: (args) => {
    fakeStageHunk(args.change as FileChange, args.hunk as Hunk);
    return null;
  },
  git_unstage_hunk: (args) => {
    fakeUnstageHunk(args.change as FileChange, args.hunk as Hunk);
    return null;
  },
  git_discard_file: (args) => {
    const change = fakeDiscardFile(args.change as FileChange);
    if (change) emitLater(change);
    return null;
  },
  git_discard_hunk: (args) => {
    const change = fakeDiscardHunk(args.change as FileChange, args.hunk as Hunk);
    if (change) emitLater(change);
    return null;
  },
  git_commit: (args) => fakeCommit(args.message as string, args.options as CommitOptions),
  git_last_commit_message: () => fakeLastCommitMessage(),
  // Branche distante : faux distant à scénarios, voir mock-remote.ts (`__mockGit.remote(…)`).
  get_git_remote_state: () => getFakeRemoteState(isFakeRepo()),
  git_fetch: () => fakeFetch(),
  git_push: () => fakePush(),
  git_pull: () => fakePull(),
  // Repères du lot 3 (rendus avec le statut) : texte indexé, blocs de gouttière (diff simplifié).
  get_git_index_text: (args) => getFakeIndexText(args.root as string, args.path as string),
  get_git_file_link_info: (args) => getFakeFileLinkInfo(args.root as string, args.path as string),
  get_git_gutter_blocks: (args) =>
    fakeGutterBlocks(args.indexText as string, args.editorText as string),
  // Issues GitHub : faux dépôt `orbit-labs/demo`, voir mock-github.ts (`__mockGithub.set(…)`).
  get_github_repo: (args) => getFakeGithubRepo(args.root as string),
  list_github_issues: (args) =>
    listFakeGithubIssues(args.root as string, args.filter as IssueFilter),
  get_github_issue: (args) => getFakeGithubIssue(args.root as string, args.number as number),
  create_github_issue: (args) => createFakeGithubIssue(args.root as string, args.issue as NewIssue),
  list_github_labels: (args) => listFakeGithubLabels(args.root as string),
  list_github_assignees: (args) => listFakeGithubAssignees(args.root as string),
  get_github_user: (args) => getFakeGithubUser(args.root as string),
  list_issue_templates: (args) => listFakeIssueTemplates(args.root as string),
  // Serveurs locaux : détection sur le faux disque (projet `~/Projets/web`), ports ouverts par
  // le faux shell (`pnpm run dev` écrit l'URL de Vite), voir mock-servers.ts.
  detect_servers: (args) => detectFakeServers(args.root as string),
  is_port_open: (args) => isFakePortOpen(args.port as number),
  // Apps natives : projets Xcode et script `tauri` de `~/Projets/web`, trois simulateurs (voir
  // mock-apps.ts, `window.__mockServers.noXcode()`).
  detect_apps: (args) => detectFakeApps(args.root as string),
  list_simulators: () => listFakeSimulators(),
  list_android_devices: () => listFakeAndroidDevices(),
  get_app_command: (args) =>
    fakeAppCommand(args.target as AppTarget, (args.deviceId as string | null) ?? null),
  // Apps Flutter : projet `~/Projets/flutter`, quatre appareils, `window.__mockServers.noFlutter()`
  // et `.noFlutterDevices()` (voir mock-apps.ts).
  list_flutter_devices: (args) => listFakeFlutterDevices(args.dir as string),
  get_flutter_command: (args) => fakeFlutterCommand(args.deviceId as string),
  // Liens externes du Markdown : le navigateur simulé n'ouvre rien, il garde la trace.
  "plugin:opener|open_url": (args) => {
    console.info("[mock] open_url", args.url);
    return null;
  },

  // Sélecteur de dossier natif : renvoie toujours le projet d'exemple.
  "plugin:dialog|open": () => DEMO_ROOT,
  // `homeDir()` et les autres dossiers système.
  "plugin:path|resolve_directory": () => HOME,
  // Zoom de la webview (spec zoom.md) : posé sur `<html>`, que le navigateur sait zoomer.
  "plugin:webview|set_webview_zoom": (args) => {
    document.documentElement.style.setProperty("zoom", String(args.value));
    return null;
  },
  // Titre de la fenêtre : reporté sur l'onglet du navigateur.
  "plugin:window|set_title": (args) => {
    document.title = args.value as string;
    return null;
  },
};

export function installMockIpc() {
  mockIPC(
    (cmd, args) => {
      const handler = handlers[cmd];
      if (handler) return handler((args ?? {}) as Record<string, unknown>);
      // Autres appels de fenêtre : rien à simuler dans le navigateur.
      if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
      throw new Error(`Commande non simulée : ${cmd}. Ajoute-la dans src/dev/mock-ipc.ts.`);
    },
    // `listen` (glisser-déposer) fonctionne sans backend.
    { shouldMockEvents: true },
  );
  // `getCurrentWindow()` et `getCurrentWebview()` ont besoin d'une fenêtre « main ».
  mockWindows("main");
  // `convertFileSrc` (images, PDF, iframe HTML) : URL `asset`, que le navigateur ne sait pas lire.
  mockConvertFileSrc("macos");
  // ⌘W est une entrée du menu de l'app en Rust (« Fermer l'onglet ») : le navigateur garde ⌘W
  // pour lui, `window.__mockMenu.closeTab()` émet le même événement.
  // De même pour ⌘S (« Enregistrer ») et ⌘Q (« Quitter », qui ne demande au front qu'avec des
  // modifications non enregistrées, comme `menu.rs`).
  (window as unknown as { __mockMenu: unknown }).__mockMenu = {
    closeTab: () => void emit("close-tab"),
    save: () => void emit("save-file"),
    // « Définir comme app par défaut… » du menu natif.
    defaultApp: () => void emit("default-app-requested"),
    quit: () =>
      unsaved || mockRunningCommands().length > 0
        ? void emit("quit-requested")
        : console.info("[mock] quit_app"),
  };
  // Finder : `open(["/Users/alex/Projets/demo/README.md"])` remplit la file et émet
  // `PathsOpened`. Lancement par le Finder : `?finder=<chemin>` dans l'URL (répétable).
  // Lien ou CLI : `openLink("explorateur://open?path=…&line=…")` ; au lancement, `?link=<url encodée>`.
  queueFromUrl(window.location.search);
  (window as unknown as { __mockFinder: unknown }).__mockFinder = {
    open: fakeFinderOpen,
    openLink: fakeOpenLink,
  };
  // Rechargement automatique : un autre outil modifie le disque (événement `DiskChanged`).
  (window as unknown as { __mockDisk: unknown }).__mockDisk = {
    write: (path: string, text: string) => emitNow(writeFakeFile(path, text)),
    remove: (path: string) => emitNow(removeFakeNode(path)),
  };
  // État du faux dépôt : "repo", "clean" (aucune modification), "notARepo", "missing" (git
  // introuvable). Relu au prochain sondage ou retour du focus ; "repo" remet le dépôt à son état
  // de départ (gestes du lot 2 oubliés).
  // Faux distant : `remote("ahead")`, `remoteAdvance(2)`, `remoteFail("auth")`, `remoteCalls()`
  // (voir mock-remote.ts).
  (window as unknown as { __mockGit: unknown }).__mockGit = {
    set: setFakeGitState,
    remote: setFakeRemote,
    remoteAdvance: advanceFakeRemote,
    remoteFail: failFakeRemote,
    remoteCalls: fakeRemoteCalls,
  };
  // État de `gh` : "ok", "ghNotFound", "notLoggedIn", "noGithubRemote", "issuesDisabled",
  // "offline" (voir mock-github.ts). `templates(false)` : dépôt sans modèle d'issue ; un titre
  // contenant « échec » fait échouer la création.
  (window as unknown as { __mockGithub: unknown }).__mockGithub = {
    set: setFakeGithub,
    templates: setFakeTemplates,
  };
  // App par défaut : `refuse = ["public.yaml"]` fait refuser ces UTI ; `?notBundled=1` dans l'URL
  // simule l'app lancée hors d'un paquet `.app`.
  (window as unknown as { __mockDefaultApp: unknown }).__mockDefaultApp = mockDefaultApp;
  // Navigateur : `newWindow(url)` simule `target="_blank"` / `window.open` d'une page.
  (window as unknown as { __mockBrowser: unknown }).__mockBrowser = browserTools;
  // Apps natives : `noXcode()` fait échouer la liste des simulateurs (« Xcode introuvable » à
  // la prochaine ouverture du menu), `xcode()` la rétablit.
  (window as unknown as { __mockServers: unknown }).__mockServers = {
    noXcode: () => setFakeXcode(false),
    xcode: () => setFakeXcode(true),
    // Apps Flutter : Flutter absent, ou aucun simulateur ni émulateur démarré.
    noFlutter: () => setFakeFlutter(false),
    flutter: () => setFakeFlutter(true),
    noFlutterDevices: () => setFakeFlutterDevices(false),
    flutterDevices: () => setFakeFlutterDevices(true),
    noAndroidSdk: () => setFakeAndroidSdk(false),
    androidSdk: () => setFakeAndroidSdk(true),
  };
}
