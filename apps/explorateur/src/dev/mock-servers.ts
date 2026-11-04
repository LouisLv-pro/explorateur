// Serveurs locaux du navigateur simulé (spec serveurs-locaux.md) : détection simplifiée sur le
// faux disque (mêmes règles que `core::servers`, sans les cas d'erreur fins) et ports « ouverts »
// par le faux shell une fois l'URL écrite.
import type { Server, ServerList } from "@/bindings";
import { findNode, type FakeNode } from "./mock-disk";

const SCRIPTS = ["dev", "start", "preview", "serve", "storybook"];
const LOCKS: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];
const NOISY = ["node_modules", "target", "__pycache__"];
const MAX_DEPTH = 6;
/** Même liste que `DEPENDENCY_DIRS` (`core/src/servers/mod.rs`), nom exact (spec menu-apps-allege.md). */
const DEPENDENCY_DIRS = [
  "SourcePackages",
  "DerivedData",
  "Pods",
  "Carthage",
  "build",
  "vendor",
  "bower_components",
  "jspm_packages",
];

/** Ports où un faux serveur répond. */
const openPorts = new Set<number>();

export function openFakePort(port: number) {
  openPorts.add(port);
}

export function closeFakePort(port: number) {
  openPorts.delete(port);
}

export function isFakePortOpen(port: number): boolean {
  return openPorts.has(port);
}

export function text(node: FakeNode | undefined): string | null {
  return node?.kind === "file" ? (node.content ?? "") : null;
}

export function parse(content: string | null): Record<string, unknown> | null {
  if (content === null) return null;
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Port d'une commande : `--port N`, `--port=N`, `-p N`. */
export function fakePortIn(command: string): number | null {
  const words = command.split(/\s+/);
  for (const [i, word] of words.entries()) {
    const value = word.startsWith("--port=")
      ? word.slice(7)
      : word === "--port" || word === "-p"
        ? words[i + 1]
        : undefined;
    if (value !== undefined) return /^\d+$/.test(value) ? Number(value) : null;
  }
  return null;
}

export function manager(root: string, dir: string): string {
  let current = dir;
  for (;;) {
    for (const [file, name] of LOCKS) if (findNode(`${current}/${file}`)) return name;
    if (current === root || !current.startsWith(`${root}/`)) return "npm";
    current = current.slice(0, current.lastIndexOf("/"));
  }
}

/** Parcours partagé avec les apps natives (comme `servers::scan`) : dossiers de package.json et
 * de pubspec.yaml, paquets Xcode (relevés sans y entrer), Cargo, Swift et projets Gradle
 * (`settings.gradle[.kts]`). */
export function scanFake(root: string): {
  packageDirs: string[];
  pubspecDirs: string[];
  xcodeBundles: string[];
  cargoDirs: string[];
  swiftDirs: string[];
  gradleDirs: string[];
} {
  const found: string[] = [];
  const pubspecs: string[] = [];
  const bundles: string[] = [];
  const cargoDirs: string[] = [];
  const swiftDirs: string[] = [];
  const gradleDirs: string[] = [];
  const walk = (path: string, depth: number) => {
    const node = findNode(path);
    if (node?.kind !== "dir" || node.denied) return;
    for (const [name, child] of Object.entries(node.children)) {
      if (child.kind === "dir") {
        if (name.startsWith(".") || NOISY.includes(name) || DEPENDENCY_DIRS.includes(name))
          continue;
        if (name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"))
          bundles.push(`${path}/${name}`);
        else if (depth < MAX_DEPTH) walk(`${path}/${name}`, depth + 1);
      } else if (name === "package.json") found.push(path);
      else if (name === "pubspec.yaml") pubspecs.push(path);
      else if (name === "Cargo.toml") cargoDirs.push(path);
      else if (name === "Package.swift") swiftDirs.push(path);
      else if (name === "settings.gradle" || name === "settings.gradle.kts") gradleDirs.push(path);
    }
  };
  walk(root, 0);
  const rel = (dir: string) => (dir === root ? "." : dir.slice(root.length + 1));
  const packageDirs = found.sort((a, b) =>
    rel(a) === "." ? -1 : rel(b) === "." ? 1 : rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0,
  );
  return {
    packageDirs,
    pubspecDirs: pubspecs.sort(),
    xcodeBundles: bundles,
    cargoDirs,
    swiftDirs,
    gradleDirs,
  };
}

const ELECTRON_PREFERRED = ["start", "dev"];

/** Vrai si la commande lance Electron (même règle que `apps::electron`). */
function launchesElectron(command: string): boolean {
  const words = command
    .replace(/[;|&]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^["']+|["']+$/g, ""));
  return words.some(
    (w, i) =>
      w === "electron" ||
      (w === "electron-forge" && words[i + 1] === "start") ||
      (w === "electron-vite" && words[i + 1] === "dev"),
  );
}

/** Script qui lance l'app Electron d'un package.json (même contrat que `apps::electron_script`). */
export function fakeElectronScript(
  json: Record<string, unknown>,
  scripts: Record<string, unknown>,
): string | null {
  const dep = (section: string) => {
    const deps = json[section];
    return typeof deps === "object" && deps !== null && "electron" in deps;
  };
  if (!dep("dependencies") && !dep("devDependencies")) return null;
  const launching = Object.entries(scripts)
    .filter(([, value]) => typeof value === "string" && launchesElectron(value))
    .map(([script]) => script)
    .sort();
  return (
    ELECTRON_PREFERRED.find((s) => launching.includes(s)) ??
    launching[0] ??
    ELECTRON_PREFERRED.find((s) => typeof scripts[s] === "string") ??
    null
  );
}

/** Même contrat que `servers::detect_servers`. */
export function detectFakeServers(root: string): ServerList {
  const servers: Server[] = [];
  let launchError: string | null = null;
  const launchText = text(findNode(`${root}/.claude/launch.json`));
  if (launchText !== null) {
    const json = parse(launchText);
    const configs = json?.configurations;
    if (!Array.isArray(configs)) launchError = "missing field `configurations` at line 1 column 2";
    else {
      for (const [i, raw] of configs.entries()) {
        const config = raw as Record<string, unknown>;
        const exe = typeof config.runtimeExecutable === "string" ? config.runtimeExecutable : null;
        const args = Array.isArray(config.runtimeArgs)
          ? config.runtimeArgs.filter((a): a is string => typeof a === "string")
          : [];
        const port = typeof config.port === "number" ? config.port : null;
        const url =
          typeof config.url === "string"
            ? config.url
            : port !== null
              ? `http://localhost:${port}`
              : null;
        servers.push({
          name: typeof config.name === "string" ? config.name : `launch.json #${i + 1}`,
          source: "launchJson",
          script: null,
          dir: root,
          relativeDir: ".",
          command: exe === null ? null : [exe, ...args].join(" "),
          port,
          url,
        });
      }
    }
  }
  for (const dir of scanFake(root).packageDirs) {
    const json = parse(text(findNode(`${dir}/package.json`)));
    const scripts = json?.scripts as Record<string, unknown> | undefined;
    if (!json || typeof scripts !== "object" || scripts === null) continue;
    const name =
      typeof json.name === "string" && json.name !== "" ? json.name : (dir.split("/").at(-1) ?? "");
    const pm = manager(root, dir);
    const electron = fakeElectronScript(json, scripts);
    for (const script of SCRIPTS) {
      const command = scripts[script];
      if (typeof command !== "string" || command === "tauri" || command.startsWith("tauri "))
        continue;
      // Le script qui lance Electron est une app (apps-commandes.md), plus un serveur.
      if (script === electron) continue;
      servers.push({
        name: `${name} · ${script}`,
        source: "packageJson",
        script: command,
        dir,
        relativeDir: dir === root ? "." : dir.slice(root.length + 1),
        command: `${pm} run ${script}`,
        port: fakePortIn(command),
        url: null,
      });
    }
  }
  return { servers, launchError };
}
