// Faux shell du navigateur simulé (spec terminal.md) : le vrai PTY de Rust n'existe pas hors de
// Tauri. Il affiche un prompt, répète la saisie, et connaît `ls` (faux disque, noms reconnus
// comme liens fichier), `pwd`, `echo …` (affiche sa ligne : `echo Voir #12 et la PR #30` donne des
// références d'issue ⌘cliquables), `sleep [s]` (processus en cours vu par `running_terminals`, ⌃C
// l'arrête), `exit [code]`, et `pnpm|npm|yarn|bun run <script>` (serveurs locaux : faux Vite
// qui écrit son URL, ouvre son port simulé et tourne jusqu'à ⌃C ; script `tauri` : fausse app
// Tauri), `xcodebuild …` (apps natives : « ** BUILD SUCCEEDED ** » puis en cours jusqu'à ⌃C),
// `… :app:installDebug …` (Android : « BUILD SUCCESSFUL ») et `expo run:*` / `react-native
// run-*` (Metro qui attend), en cours jusqu'à ⌃C.
import { events, type AppError, type FileLink, type RunningTerminal } from "@/bindings";
import i18n from "@/i18n";
import { findNode, listFakeDirectory } from "./mock-disk";
import { fakeGithubLoggedIn } from "./mock-github";
import { closeFakePort, fakePortIn, openFakePort } from "./mock-servers";

type Output = { onmessage: (data: ArrayBuffer) => void };

/** Processus en cours : `sleep` (minuteur) ou faux serveur (port). */
type Running = {
  command: string;
  timer: ReturnType<typeof setTimeout> | null;
  port: number | null;
};

type FakeSession = {
  cwd: string;
  out: Output;
  line: string;
  running: Running | null;
};

/** Arrête le processus en cours de la session (minuteur, port du faux serveur). */
function stopRunning(session: FakeSession) {
  if (session.running?.timer) clearTimeout(session.running.timer);
  const port = session.running?.port ?? null;
  if (port !== null) closeFakePort(port);
  session.running = null;
}

const MANAGERS = ["pnpm", "npm", "yarn", "bun"];

/** `<gestionnaire> run <script>` : faux Vite si le script existe dans le package.json du dossier. */
function runScript(session: FakeSession, manager: string, script: string | undefined) {
  const node = findNode(`${session.cwd}/package.json`);
  let scripts: Record<string, unknown> = {};
  try {
    const json: unknown = JSON.parse(node?.kind === "file" ? (node.content ?? "") : "");
    scripts = ((json as { scripts?: Record<string, unknown> }).scripts ?? {}) as Record<
      string,
      unknown
    >;
  } catch {
    // Pas de package.json lisible : script manquant.
  }
  const command = script === undefined ? undefined : scripts[script];
  if (typeof command !== "string") {
    send(session, `\x1b[31mERR_PNPM_NO_SCRIPT\x1b[39m  Missing script: ${script ?? ""}\r\n`);
    prompt(session);
    return;
  }
  if (command === "tauri" || command.startsWith("tauri dev")) {
    // App Tauri (spec apps-natives.md) : compilation puis fenêtre, jusqu'à ⌃C, sans port.
    send(session, `\x1b]0;${manager}\x07\r\n> ${command === "tauri" ? "tauri dev" : command}\r\n`);
    startFakeApp(session, manager, [
      "     Running DevCommand (`cargo  run --no-default-features --color always --`)",
      "   Compiling app v0.1.0",
      "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.21s",
      "     Running `target/debug/app`",
    ]);
    return;
  }
  if (/^electron\b/.test(command)) {
    // App Electron (spec apps-commandes.md) : fenêtre jusqu'à ⌃C, sans port.
    send(session, `\x1b]0;${manager}\x07\r\n> ${command}\r\n`);
    startFakeApp(session, manager, ["Electron 33.0.0 : fenêtre ouverte"]);
    return;
  }
  const port = fakePortIn(command) ?? 5173;
  send(session, `\x1b]0;${manager}\x07\r\n> ${command}\r\n`);
  const running: Running = { command: manager, timer: null, port: null };
  session.running = running;
  // Vite écrit son URL après un court démarrage ; le port répond ensuite (simulé).
  running.timer = setTimeout(() => {
    running.timer = null;
    send(
      session,
      `\r\n  \x1b[32m\x1b[1mVITE\x1b[22m v6.0.0\x1b[39m  ready in 312 ms\r\n\r\n` +
        `  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   ` +
        `\x1b[36mhttp://localhost:\x1b[1m${port}\x1b[22m/\x1b[39m\r\n` +
        `  \x1b[32m➜\x1b[39m  \x1b[1mNetwork\x1b[22m: use --host to expose\r\n`,
    );
    running.port = port;
    openFakePort(port);
  }, 600);
}

/** Faux processus d'app native : écrit `lines` après un court délai et tourne jusqu'à ⌃C. */
function startFakeApp(session: FakeSession, command: string, lines: string[]) {
  const running: Running = { command, timer: null, port: null };
  session.running = running;
  running.timer = setTimeout(() => {
    running.timer = null;
    send(session, lines.map((l) => `${l}\r\n`).join(""));
  }, 600);
}

/** `xcodebuild … && …` (commande d'une app Xcode) : compilation réussie, puis l'app tourne. */
function runXcode(session: FakeSession, line: string) {
  send(session, `\x1b]0;xcodebuild\x07`);
  const ios = line.includes("simctl launch");
  startFakeApp(session, "xcodebuild", [
    "Command line invocation:",
    `    ${line.split(" && ")[0] ?? ""}`,
    "",
    "CompileSwift normal arm64 ContentView.swift",
    "** BUILD SUCCEEDED **",
    "",
    ...(ios
      ? ["com.example.demo: 48213", "Bonjour depuis le Simulateur"]
      : ["Bonjour depuis macOS"]),
  ]);
}

/** Étape de compilation de `flutter run` selon l'appareil (`chrome`, `emulator-…`, simulateur). */
function flutterBuildStep(device: string): string {
  if (device === "chrome") return "Waiting for connection from debug service on Chrome...";
  if (device.startsWith("emulator-")) return "Running Gradle task 'assembleDebug'...";
  return "Running Xcode build...";
}

/** `<flutter> run -d <appareil>` (app Flutter) : compilation, puis l'app tourne jusqu'à ⌃C. */
function runFlutter(session: FakeSession, line: string) {
  const device = line.split(" -d ")[1] ?? "?";
  send(session, `\x1b]0;flutter\x07`);
  startFakeApp(session, "flutter", [
    `Launching lib/main.dart on ${device} in debug mode...`,
    flutterBuildStep(device),
    "Syncing files to device...",
    "",
    "Flutter run key commands.",
    "r Hot reload.",
    "R Hot restart.",
    "q Quit (terminate the application on the device).",
  ]);
}

/** `… gradlew :app:installDebug && …` (app Android) : compilation, installation, journaux. */
function runGradle(session: FakeSession) {
  send(session, `\x1b]0;gradlew\x07`);
  startFakeApp(session, "gradlew", [
    "> Task :app:installDebug",
    "Installing APK 'app-debug.apk' on 'Pixel_Tablet_API_35(AVD) - 15' for :app:debug",
    "",
    "BUILD SUCCESSFUL in 7s",
    "Status: ok",
    "I/meteo   ( 4821): Bonjour depuis l'émulateur",
  ]);
}

/** `pnpm expo run:*` ou `react-native run-*` : compilation, puis Metro attend jusqu'à ⌃C. */
function runMetro(session: FakeSession, line: string) {
  const tool = line.includes("expo run:") ? "expo" : "react-native";
  send(session, `\x1b]0;${tool}\x07`);
  startFakeApp(session, tool, [
    "› Building app...",
    "› Installing on device",
    "",
    "Metro waiting on exp://192.168.1.20:8081",
    "› Press r │ reload app",
  ]);
}

/** `cargo run [--bin x]` et `swift run x` (apps Rust et Swift) : compilation puis l'app tourne
 * jusqu'à ⌃C. */
function runToolchain(session: FakeSession, tool: "cargo" | "swift", args: string[]) {
  const bin = args.includes("--bin") ? args[args.indexOf("--bin") + 1] : args[1];
  const target = bin ?? nameOf(session.cwd);
  send(session, `\x1b]0;${tool}\x07`);
  startFakeApp(
    session,
    tool,
    tool === "cargo"
      ? [
          `   Compiling ${target} v0.1.0 (${session.cwd})`,
          "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.84s",
          `     Running \`target/debug/${target}\``,
          "Bonjour depuis Rust",
        ]
      : [
          `[1/1] Compiling ${target}`,
          "Build of product '" + target + "' complete! (1.20s)",
          "Bonjour depuis Swift",
        ],
  );
}

const sessions = new Map<number, FakeSession>();
const encoder = new TextEncoder();

const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? "/";

function send(session: FakeSession, text: string) {
  const bytes = encoder.encode(text);
  // Hors de la fonction appelante, comme une sortie de Rust qui arrive plus tard.
  setTimeout(() => session.out.onmessage(bytes.buffer), 0);
}

function prompt(session: FakeSession) {
  // OSC 0 : le titre de la page revient au dossier courant.
  send(session, `\x1b]0;${nameOf(session.cwd)}\x07\x1b[32m${nameOf(session.cwd)}\x1b[0m $ `);
}

function exit(id: number, code: number) {
  const session = sessions.get(id);
  if (session) stopRunning(session);
  sessions.delete(id);
  setTimeout(() => void events.terminalExited.emit({ id, code }), 20);
}

function run(id: number, session: FakeSession, line: string) {
  // Apps Android, Expo et React Native : la commande commence par le démarrage de l'émulateur,
  // `adb` ou Metro ; reconnue à son étape de compilation.
  if (line.includes(":installDebug")) {
    runGradle(session);
    return;
  }
  if (/\b(expo run:|react-native run-)/.test(line)) {
    runMetro(session, line);
    return;
  }
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case undefined:
    case "":
      break;
    case "ls": {
      const names = listFakeDirectory(session.cwd, false).map((e) =>
        e.is_dir ? `\x1b[34m${e.name}/\x1b[0m` : e.name,
      );
      send(session, names.join("  ") + "\r\n");
      break;
    }
    case "pwd":
      send(session, `${session.cwd}\r\n`);
      break;
    case "echo":
      // `echo Voir #12 et la PR #30` : références d'issue ⌘cliquables (lot 3 des issues).
      send(session, `${args.join(" ")}\r\n`);
      break;
    case "sleep": {
      const seconds = Number(args[0] ?? 5);
      send(session, `\x1b]0;sleep\x07`);
      const timer = setTimeout(
        () => {
          session.running = null;
          prompt(session);
        },
        (Number.isFinite(seconds) ? seconds : 5) * 1000,
      );
      session.running = { command: "sleep", timer, port: null };
      return;
    }
    case "gh": {
      // `gh auth login` : « connecté » deux secondes plus tard (voir mock-github.ts).
      if (args.join(" ") !== "auth login") {
        send(session, "mock-shell: seul `gh auth login` est simulé\r\n");
        break;
      }
      send(
        session,
        `\x1b]0;gh\x07? How would you like to authenticate GitHub CLI? Web browser\r\n`,
      );
      const timer = setTimeout(() => {
        fakeGithubLoggedIn();
        send(session, "\x1b[32m✓\x1b[0m Logged in as alex\r\n");
        session.running = null;
        prompt(session);
      }, 2000);
      session.running = { command: "gh", timer, port: null };
      return;
    }
    case "exit":
      exit(id, Number(args[0] ?? 0) || 0);
      return;
    case "xcodebuild":
      runXcode(session, line.trim());
      return;
    case "cargo":
    case "swift":
      if (args[0] === "run") {
        runToolchain(session, cmd, args);
        return;
      }
      send(session, `mock-shell: ${cmd} ${args[0] ?? ""} non géré\r\n`);
      break;
    default:
      if (MANAGERS.includes(cmd) && args[0] === "run") {
        runScript(session, cmd, args[1]);
        return;
      }
      if (cmd.endsWith("/flutter") && args[0] === "run") {
        runFlutter(session, line.trim());
        return;
      }
      send(session, `mock-shell: commande inconnue : ${cmd}\r\n`);
  }
  prompt(session);
}

/** `ESC [ … lettre` (flèches, touches de fonction). */
const ESCAPE_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

function input(id: number, data: string) {
  const session = sessions.get(id);
  if (!session) return;
  // Séquences d'échappement (flèches…) ignorées.
  const text = data.replace(ESCAPE_SEQUENCE, "");
  for (const char of text) {
    if (char === "\x03") {
      stopRunning(session);
      session.line = "";
      send(session, "^C\r\n");
      prompt(session);
    } else if (session.running?.command === "flutter" && (char === "r" || char === "R")) {
      // `flutter run` lit les touches une à une, sans écho ni Entrée.
      send(
        session,
        char === "r"
          ? "Performing hot reload...\r\nReloaded 1 of 1 libraries in 212ms.\r\n"
          : "Performing hot restart...\r\nRestarted application in 640ms.\r\n",
      );
    } else if (session.running) {
      // Pendant `sleep`, la saisie est répétée mais pas exécutée (comme un vrai terminal).
      send(session, char === "\r" ? "\r\n" : char);
    } else if (char === "\r") {
      send(session, "\r\n");
      const line = session.line;
      session.line = "";
      run(id, session, line);
    } else if (char === "\x7f") {
      if (session.line.length > 0) {
        session.line = session.line.slice(0, -1);
        send(session, "\b \b");
      }
    } else if (char === "\x04") {
      if (session.line === "") exit(id, 0);
    } else if (char >= " ") {
      session.line += char;
      send(session, char);
    }
  }
}

/** Commandes en cours (`sleep`), pages dans l'ordre de leur identifiant, sans doublon. */
export function mockRunningCommands(): string[] {
  return [...new Set(runningTerminals().map((r) => r.command))];
}

function runningTerminals(): RunningTerminal[] {
  return [...sessions.entries()]
    .flatMap(([id, s]) => (s.running === null ? [] : [{ id, command: s.running.command }]))
    .sort((a, b) => a.id - b.id);
}

/** Même règle que `core::terminal::shell_quote` : caractères sûrs tels quels, sinon apostrophes. */
function mockShellQuote(path: string): string {
  if (/^[\p{L}\p{N}/._+,@%-]+$/u.test(path)) return path;
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/** Version simple de `find_file_links` : mots de la ligne, `:ligne[:col]`, fichiers du faux disque sous la racine. */
function mockFindLinks(line: string, cwd: string, root: string): FileLink[] {
  const links: FileLink[] = [];
  for (const match of line.matchAll(/\S+/g)) {
    const word = match[0];
    const lead = word.length - word.replace(/^[(["'<{`]+/, "").length;
    const core = word.slice(lead).replace(/[)\]}>"'`,;:.!?]+$/, "");
    const [, path = core, lineNo, column] = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(core) ?? [];
    const absolute = normalize(path.startsWith("/") ? path : `${cwd}/${path}`);
    if (!(absolute === root || absolute.startsWith(`${root}/`))) continue;
    if (findNode(absolute)?.kind !== "file") continue;
    const start = match.index + lead;
    links.push({
      start,
      end: start + core.length,
      path: absolute,
      line: lineNo ? Number(lineNo) : null,
      column: column ? Number(column) : null,
    });
  }
  return links;
}

/** Retire `.` et `..` d'un chemin absolu. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Commandes du terminal pour `mockIPC`, même contrat que `commands/terminal.rs`. */
export const terminalHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  start_terminal: (args) => {
    const id = args.id as number;
    const cwd = args.cwd as string;
    const node = findNode(cwd);
    if (!node) throw { kind: "NotFound", message: cwd } satisfies AppError;
    if (node.kind !== "dir") throw { kind: "NotADirectory", message: cwd } satisfies AppError;
    const old = sessions.get(id);
    if (old) stopRunning(old);
    const session: FakeSession = { cwd, out: args.onOutput as Output, line: "", running: null };
    sessions.set(id, session);
    send(session, `${i18n.t("terminal:simulatedShell")}\r\n`);
    prompt(session);
    return null;
  },
  write_terminal: (args) => {
    const id = args.id as number;
    if (!sessions.has(id)) throw { kind: "NotFound", message: `terminal ${id}` } satisfies AppError;
    input(id, args.data as string);
    return null;
  },
  resize_terminal: () => null,
  running_terminals: () => runningTerminals(),
  running_commands: () => mockRunningCommands(),
  find_terminal_links: (args) =>
    mockFindLinks(args.line as string, args.cwd as string, args.root as string),
  shell_quote: (args) => mockShellQuote(args.path as string),
  close_terminal: (args) => {
    const session = sessions.get(args.id as number);
    if (session) stopRunning(session);
    sessions.delete(args.id as number);
    return null;
  },
};
