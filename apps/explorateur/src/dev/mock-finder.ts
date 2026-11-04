// Simule l'ouverture depuis le Finder, un lien ou la commande `explorateur` (specs
// ouvrir-depuis-finder.md et ouvrir-depuis-terminal.md) : la file des demandes de Rust
// (`RunEvent::Opened`), `folders::parse_open_link` et `folders::resolve_requests` sur le faux disque.
import { events, type Entry, type OpenTarget } from "@/bindings";
import { DEMO_ROOT, findNode, previewKindOf } from "./mock-disk";

/** Même contrat que `folders::OpenRequest` en Rust. */
export type FakeRequest = {
  path: string;
  line: number | null;
  column: number | null;
  link: boolean;
};

/** Demandes reçues, pas encore lues par le front. */
let queue: FakeRequest[] = [];

/** Chemin sans `/` doublés ni final, `.` et `..` résolus (le faux disque n'a pas de lien symbolique). */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

const isUnder = (path: string, dir: string) => dir === "/" || path.startsWith(`${dir}/`);

const parentOf = (path: string) => normalize(path.split("/").slice(0, -1).join("/"));

/** Même règle que Rust, `git::repo_top` en moins : le faux dépôt `demo` est la seule racine git. */
function repoRootOf(path: string): string {
  return isUnder(path, DEMO_ROOT) ? DEMO_ROOT : parentOf(path);
}

/** Même contrat que `folders::resolve_open` en Rust. */
export function resolveFakeOpen(currentRoot: string | null, paths: string[]): OpenTarget | null {
  const existing = paths.filter((p) => p.startsWith("/")).map(normalize);
  const found = existing.filter((p) => findNode(p) !== undefined);
  const first = found[0];
  if (first === undefined) return null;

  const current = currentRoot === null ? null : normalize(currentRoot);
  let root: string;
  if (findNode(first)?.kind === "dir") root = first;
  else if (current !== null && findNode(current)?.kind === "dir" && isUnder(first, current)) {
    root = current;
  } else root = repoRootOf(first);

  const files: Entry[] = [];
  for (const path of new Set(found)) {
    if (!isUnder(path, root) || findNode(path)?.kind === "dir") continue;
    const name = path.split("/").at(-1) ?? path;
    files.push({ name, path, is_dir: false, preview_kind: previewKindOf(name) });
  }
  return { root, files };
}

/** Même contrat que `folders::resolve_requests` en Rust. */
export function resolveFakeRequests(
  currentRoot: string | null,
  requests: FakeRequest[],
): OpenTarget | null {
  const target = resolveFakeOpen(
    currentRoot,
    requests.map((r) => r.path),
  );
  if (target === null) return null;
  const last = requests.at(-1);
  const current = target.files.at(-1);
  const isCurrent =
    last !== undefined &&
    current !== undefined &&
    last.path.startsWith("/") &&
    normalize(last.path) === current.path;
  return {
    ...target,
    line: isCurrent ? last.line : null,
    column: isCurrent ? last.column : null,
    link: requests.some((r) => r.link),
  };
}

/** Entier ≥ 1 écrit en chiffres seuls, sinon `null`. */
function positive(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 0xffff_ffff ? n : null;
}

/** `chemin:N` ou `chemin:N:M` → chemin, ligne, colonne. `null` si la fin n'est pas un tel suffixe. */
function splitSuffix(path: string): { path: string; line: number; column: number | null } | null {
  const cut = path.lastIndexOf(":");
  if (cut < 0) return null;
  const last = positive(path.slice(cut + 1));
  if (last === null) return null;
  const head = path.slice(0, cut);
  const midCut = head.lastIndexOf(":");
  const mid = midCut < 0 ? null : positive(head.slice(midCut + 1));
  if (mid !== null) return { path: head.slice(0, midCut), line: mid, column: last };
  return { path: head, line: last, column: null };
}

/**
 * Décodage `%xx` qui garde `+` ; `null` si l'UTF-8 est invalide. Un `%` non suivi de deux
 * chiffres hexadécimaux reste tel quel, comme avec `percent_decode_str`.
 */
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
  } catch {
    return null;
  }
}

/** Même contrat que `folders::parse_open_link` en Rust. */
export function parseFakeLink(url: string): FakeRequest | null {
  const noFragment = url.split("#")[0] ?? "";
  const sep = noFragment.indexOf("://");
  if (sep < 0 || noFragment.slice(0, sep).toLowerCase() !== "explorateur") return null;
  const rest = noFragment.slice(sep + 3);
  const q = rest.indexOf("?");
  if (q < 0) return null;
  const host = rest.slice(0, q).toLowerCase();
  if (host !== "open" && host !== "open/") return null;

  const params = new Map<string, string>();
  for (const pair of rest.slice(q + 1).split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = decode(eq < 0 ? "" : pair.slice(eq + 1));
    if (key === null || value === null) return null;
    if (!params.has(key)) params.set(key, value);
  }

  let path = params.get("path");
  if (path === undefined || !path.startsWith("/")) return null;
  let line = positive(params.get("line"));
  let column = line === null ? null : positive(params.get("column"));
  if (line === null && findNode(normalize(path)) === undefined) {
    const suffix = splitSuffix(path);
    if (suffix !== null) ({ path, line, column } = suffix);
  }
  return { path, line, column, link: true };
}

/** Vide la file : même contrat que la commande `take_opened_paths`. */
export function takeFakeOpened(currentRoot: string | null): OpenTarget | null {
  const requests = queue;
  queue = [];
  return requests.length === 0 ? null : resolveFakeRequests(currentRoot, requests);
}

const fromFinder = (path: string): FakeRequest => ({ path, line: null, column: null, link: false });

/** `window.__mockFinder.open(paths)` : le Finder ouvre `paths`, puis `PathsOpened` part. */
export function fakeFinderOpen(paths: string[]) {
  queue.push(...paths.map(fromFinder));
  void events.pathsOpened.emit();
}

/** `window.__mockFinder.openLink(url)` : un lien ou la CLI, puis `PathsOpened` part. */
export function fakeOpenLink(url: string) {
  const request = parseFakeLink(url);
  if (request === null) {
    console.warn("[mock] lien explorateur refusé :", url);
    return;
  }
  queue.push(request);
  void events.pathsOpened.emit();
}

/**
 * Lancement par le Finder ou un lien : `?finder=<chemin>` (répétable) et `?link=<url encodée>`
 * remplissent la file avant le front.
 */
export function queueFromUrl(search: string) {
  const params = new URLSearchParams(search);
  queue.push(...params.getAll("finder").map(fromFinder));
  for (const url of params.getAll("link")) {
    const request = parseFakeLink(url);
    if (request === null) console.warn("[mock] lien explorateur refusé :", url);
    else queue.push(request);
  }
}
