// Faux dépôt git du navigateur simulé (décision 0007) : git n'existe pas hors de Tauri. Dépôt
// en mémoire, à la racine `~/Projets` (le dossier racine `demo` en est un sous-dossier), avec une
// modification de chaque statut, un fichier indexé puis modifié, un binaire, un diff trop long,
// un changement de mode seul et un fichier hors du dossier. Les diffs sont calculés ici par un
// diff de lignes simple, aux mêmes conventions que Rust (3 lignes de contexte, lignes masquées).
// Les gestes du lot 2 (indexer, désindexer, annuler, committer) changent ce dépôt en mémoire ;
// les fichiers présents sur le faux disque (`mock-disk.ts`) y sont lus et écrits. Un message de
// commit qui contient « échec » simule un hook `pre-commit` qui échoue.
// `window.__mockGit.set("repo" | "clean" | "notARepo" | "missing")` change l'état du dépôt
// ("repo" le remet à son état de départ). Le faux distant (récupérer, pousser, tirer) est dans
// `mock-remote.ts`.
import type {
  AppError,
  ChangeStatus,
  CharRange,
  CommitOptions,
  Diff,
  DiffContent,
  DiffLine,
  DiskChange,
  FileChange,
  FileLinkInfo,
  GitSnapshot,
  GutterBlock,
  Hunk,
  PathMark,
  PathStatuses,
  RepoStatus,
} from "@/bindings";
import { DEMO_ROOT, HOME, findNode, removeFakeNode, writeFakeFile } from "./mock-disk";
import { noteFakeCommit, resetFakeRemote } from "./mock-remote";

/** Racine du faux dépôt. */
const TOP = `${HOME}/Projets`;
/** Chemin du dossier racine dans le dépôt `~/Projets`. */
const PREFIX = "demo/";
const CONTEXT = 3;
const MAX_DIFF_LINES = 2000;
const BRANCH = "travail/git";

type MockState = "repo" | "clean" | "notARepo" | "missing";
let state: MockState = "repo";

/** Contenu du disque simulé (`mock-disk.ts`), vide s'il est absent. */
function diskText(rel: string): string {
  const node = findNode(`${DEMO_ROOT}/${rel}`);
  return node?.kind === "file" ? (node.content ?? "") : "";
}

const replace = (text: string, from: string, to: string) => text.replace(from, to);

/**
 * Un fichier du faux dépôt : ses versions HEAD, index et disque (`null` : absent de ce côté).
 * Un binaire porte sa taille en octets à la place du contenu.
 */
type FakeFile = {
  head: string | null;
  index: string | null;
  /** Version disque propre au dépôt, sauf `live` : lue et écrite sur le faux disque. */
  disk: string | null;
  live: boolean;
  binary?: true;
  /** Modes (`100644`, `100755`) des trois versions. */
  modes?: { head: string; index: string; disk: string };
  /** Renommage indexé : ancien chemin (relatif au dépôt). */
  orig?: string;
  conflict?: true;
};

const LONG = Array.from({ length: 2100 }, (_, i) => `  "cle${i + 1}": ${i + 1},`).join("\n");
const DEPLOY = "#!/bin/sh\nset -e\npnpm build\nrsync -a dist/ serveur:/var/www/\n";
const CONFLICT_BASE = 'titre = "Démo"\nversion = 1\n';

function initialFiles(): Map<string, FakeFile> {
  const mainDisk = diskText("src/main.rs");
  const mainIndex = replace(
    mainDisk,
    "    counts\n}",
    "    // Ajouté dans le terminal.\n    counts\n}",
  );
  const readmeIndex = replace(
    replace(diskText("README.md"), "Projet d'exemple du navigateur simulé.", "Projet d'exemple."),
    "- [ ] Rechercher un fichier",
    "- [ ] Rechercher un fichier\n- [ ] Ouvrir un terminal",
  );
  const guide = diskText("docs/guide.md");
  const ancien = "export const ancien = 1;\nexport const autre = 2;\n";
  const nouveau = "# Nouveau\n\nPage ajoutée et indexée.\n";
  const build = "#!/bin/sh\npnpm build\n";
  const entries: [string, FakeFile][] = [
    [
      "demo/src/main.rs",
      {
        head: replace(mainIndex, "fn count(text: &str)", "fn compte(text: &str)"),
        index: mainIndex,
        disk: null,
        live: true,
      },
    ],
    ["demo/README.md", { head: readmeIndex, index: readmeIndex, disk: null, live: true }],
    ["demo/docs/nouveau.md", { head: null, index: nouveau, disk: nouveau, live: false }],
    [
      "demo/docs/guide.md",
      { head: null, index: guide, disk: null, live: true, orig: "demo/docs/guide-v1.md" },
    ],
    ["demo/docs/guide-v1.md", { head: guide, index: null, disk: null, live: false }],
    ["demo/src/ancien.ts", { head: ancien, index: ancien, disk: null, live: false }],
    [
      "demo/assets/logo.png",
      { head: "3800", index: "3800", disk: "4096", live: false, binary: true },
    ],
    ["demo/page10.md", { head: null, index: null, disk: null, live: true }],
    ["demo/genere/gros.json", { head: null, index: null, disk: `{\n${LONG}\n}\n`, live: false }],
    [
      "demo/scripts/build.sh",
      {
        head: build,
        index: build,
        disk: build,
        live: false,
        modes: { head: "100644", index: "100644", disk: "100755" },
      },
    ],
    [
      "demo/conflit.txt",
      {
        head: CONFLICT_BASE,
        index: CONFLICT_BASE,
        disk: '<<<<<<< HEAD\ntitre = "Démo"\n=======\ntitre = "Exemple"\n>>>>>>> autre\nversion = 1\n',
        live: false,
        conflict: true,
      },
    ],
    [
      "outils/deploy.sh",
      {
        head: DEPLOY,
        index: DEPLOY,
        // Sans fin de ligne finale : « pas de fin de ligne » sur la dernière ligne ajoutée.
        disk: replace(
          replace(DEPLOY, "pnpm build", "pnpm install\npnpm build"),
          "/var/www/\n",
          "/srv/www/",
        ),
        live: false,
      },
    ],
  ];
  return new Map(entries);
}

let files: Map<string, FakeFile> | null = null;
let lastMessage: string | null = "Ajoute le volet Modifications\n\nLot 1 : statut et diffs.";
let commitSeq = 0;

/** Fichiers du dépôt, créés au premier appel (le faux disque est prêt). */
function store(): Map<string, FakeFile> {
  files ??= initialFiles();
  return files;
}

const absPath = (repoPath: string) => `${TOP}/${repoPath}`;

function diskOf(file: FakeFile, repoPath: string): string | null {
  if (!file.live) return file.disk;
  const node = findNode(absPath(repoPath));
  return node?.kind === "file" ? (node.content ?? "") : null;
}

/** Écrit la version disque ; rend le lot de changements du faux disque à émettre. */
function setDisk(file: FakeFile, repoPath: string, text: string | null): DiskChange | null {
  if (!file.live) {
    file.disk = text;
    return null;
  }
  const path = absPath(repoPath);
  if (text === null) return findNode(path) ? removeFakeNode(path) : null;
  return writeFakeFile(path, text);
}

function gitFail(message: string): never {
  throw { kind: "Git", message } satisfies AppError;
}

/** Dossier non suivi replié du faux dépôt (60 fichiers sur le faux disque, `mock-disk.ts`). */
const FOLDED_REPO = `${PREFIX}src/build-fix/`;
const FOLDED_DISK = `${DEMO_ROOT}/src/build-fix`;

function fileChange(
  repoPath: string,
  status: FileChange["status"],
  staged: boolean,
  orig: string | null = null,
): FileChange {
  const display = (p: string) => (p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p);
  const outsideRoot = !repoPath.startsWith(PREFIX);
  let added = 0;
  let removed = 0;
  if (status !== "!") {
    const content = diffOf(repoPath, staged, status);
    if (content.kind === "text") {
      for (const hunk of content.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === "added") added += 1;
          if (line.kind === "removed") removed += 1;
        }
      }
    }
  }
  return {
    path: display(repoPath),
    repoPath,
    origPath: orig === null ? null : display(orig),
    origRepoPath: orig,
    status,
    staged,
    added,
    removed,
    outsideRoot,
  };
}

/** Chemins triés comme en Rust : ceux du dossier racine, puis ceux hors de lui. */
function sortedPaths(): string[] {
  const rank = (p: string) => (p.startsWith(PREFIX) ? 0 : 1);
  return [...store().keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function fakeStatus(): RepoStatus {
  const head = { kind: "branch" as const, name: BRANCH };
  if (state === "clean") return { kind: "repo", head, staged: [], unstaged: [] };
  const all = store();
  // Ancien chemin d'un renommage indexé : pas listé comme suppression.
  const renamedFrom = new Set(
    [...all.values()].flatMap((f) =>
      f.orig && f.head === null && f.index !== null ? [f.orig] : [],
    ),
  );
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  for (const path of sortedPaths()) {
    const f = all.get(path);
    if (!f) continue;
    if (f.conflict) {
      unstaged.push(fileChange(path, "!", false));
      continue;
    }
    if (f.head !== f.index || f.modes?.head !== f.modes?.index) {
      if (f.index === null) {
        if (!renamedFrom.has(path)) staged.push(fileChange(path, "D", true));
      } else if (f.head === null) {
        staged.push(f.orig ? fileChange(path, "R", true, f.orig) : fileChange(path, "A", true));
      } else {
        staged.push(fileChange(path, "M", true));
      }
    }
    const disk = diskOf(f, path);
    if (f.index !== disk || f.modes?.index !== f.modes?.disk) {
      if (f.index === null) {
        if (disk !== null) unstaged.push(fileChange(path, "U", false));
      } else if (disk === null) {
        unstaged.push(fileChange(path, "D", false));
      } else {
        unstaged.push(fileChange(path, "M", false));
      }
    }
  }
  // Dossier non suivi replié : une seule ligne, tant qu'il est sur le faux disque.
  if (findNode(FOLDED_DISK)?.kind === "dir") {
    unstaged.push({
      path: FOLDED_REPO.slice(PREFIX.length),
      repoPath: FOLDED_REPO,
      origPath: null,
      origRepoPath: null,
      status: "U",
      staged: false,
      added: 0,
      removed: 0,
      outsideRoot: false,
    });
    const rank = (c: FileChange) => (c.outsideRoot ? 1 : 0);
    unstaged.sort((a, b) => rank(a) - rank(b) || a.repoPath.localeCompare(b.repoPath));
  }
  return { kind: "repo", head, staged, unstaged };
}

export function getFakeGitStatus(root: string): RepoStatus {
  if (state === "missing") return { kind: "gitNotFound", path: "/opt/homebrew/bin/git" };
  if (state === "notARepo" || root !== DEMO_ROOT) return { kind: "notARepo" };
  return fakeStatus();
}

/** Ce que rend `get_git_status` : statut et repères de l'arborescence (un seul appel). */
export function getFakeGitSnapshot(root: string): GitSnapshot {
  return { status: getFakeGitStatus(root), marks: getFakePathStatuses(root) };
}

/** Les deux versions comparées : HEAD et index si indexé, index et disque sinon. */
function sidesOf(repoPath: string, staged: boolean, status: FileChange["status"]) {
  const f = store().get(repoPath);
  if (!f) return { old: null, new: null, file: undefined };
  if (status === "U") return { old: null, new: diskOf(f, repoPath), file: f };
  if (staged) {
    const old = f.orig && f.head === null ? (store().get(f.orig)?.head ?? null) : f.head;
    return { old, new: f.index, file: f };
  }
  return { old: f.index, new: diskOf(f, repoPath), file: f };
}

function diffOf(repoPath: string, staged: boolean, status: FileChange["status"]): DiffContent {
  const sides = sidesOf(repoPath, staged, status);
  if (sides.file?.binary) {
    return {
      kind: "binary",
      oldSize: sides.old === null ? null : Number(sides.old),
      newSize: sides.new === null ? null : Number(sides.new),
    };
  }
  return textDiff(sides.old ?? "", sides.new ?? "");
}

export function getFakeGitDiff(change: FileChange): Diff {
  if (state === "missing" || state === "notARepo") {
    throw { kind: "Failed", message: { reason: "notARepo", detail: "." } } satisfies AppError;
  }
  const modes = store().get(change.repoPath)?.modes;
  const [oldMode, newMode] = change.staged
    ? [modes?.head, modes?.index]
    : [modes?.index, modes?.disk];
  const modeChanged = oldMode !== undefined && newMode !== undefined && oldMode !== newMode;
  return {
    oldMode: modeChanged ? oldMode : null,
    newMode: modeChanged ? newMode : null,
    content: diffOf(change.repoPath, change.staged, change.status),
  };
}

export function getFakeHiddenLines(change: FileChange, gap: number): DiffLine[] {
  const content = diffOf(change.repoPath, change.staged, change.status);
  if (content.kind !== "text") return [];
  const sides = sidesOf(change.repoPath, change.staged, change.status);
  const lines = splitLines(sides.new ?? "");
  const prev = content.hunks[gap - 1];
  const oldPrev = prev ? endLine(prev.oldStart, prev.oldCount) : 0;
  const newPrev = prev ? endLine(prev.newStart, prev.newCount) : 0;
  const next = content.hunks[gap];
  const newLast = next ? beforeLine(next.newStart, next.newCount) : lines.length;
  const result: DiffLine[] = [];
  for (let n = newPrev + 1; n <= newLast; n += 1) {
    result.push(context(n - newPrev + oldPrev, n, lines[n - 1] ?? ""));
  }
  return result;
}

// --- Gestes du lot 2 (mêmes contrats que `core/src/git/write.rs`) ------------------------

function fileOf(repoPath: string): FakeFile {
  return store().get(repoPath) ?? gitFail(`error: pathspec '${repoPath}' did not match any files`);
}

/** Oublie un fichier absent des trois côtés (non suivi mis à la corbeille, suppression commitée). */
function prune(repoPath: string) {
  const f = store().get(repoPath);
  if (f && f.head === null && f.index === null && diskOf(f, repoPath) === null) {
    store().delete(repoPath);
  }
}

function stagePath(repoPath: string) {
  const f = fileOf(repoPath);
  delete f.conflict;
  f.index = diskOf(f, repoPath);
  if (f.modes) f.modes.index = f.modes.disk;
}

function unstagePath(repoPath: string) {
  const f = fileOf(repoPath);
  if (f.orig && f.head === null) {
    const orig = store().get(f.orig);
    if (orig) orig.index = orig.head;
    delete f.orig;
  }
  f.index = f.head;
  if (f.modes) f.modes.index = f.modes.head;
}

/** Ajout, suppression ou non suivi : un bloc couvre tout le fichier. */
const wholeFile = (change: FileChange) => ["U", "A", "D"].includes(change.status);

/**
 * Applique un bloc à `text` (à l'envers : `reverse`), comme `git apply` : le côté de départ
 * doit se retrouver à sa place, sinon le patch est refusé.
 */
function applyHunk(path: string, text: string | null, hunk: Hunk, reverse: boolean): string {
  const lines = splitLines(text ?? "");
  const from = hunk.lines.filter((l) => l.kind !== (reverse ? "removed" : "added"));
  const to = hunk.lines.filter((l) => l.kind !== (reverse ? "added" : "removed"));
  const start = reverse ? hunk.newStart : hunk.oldStart;
  const at = from.length === 0 ? start : start - 1;
  const current = lines.slice(at, at + from.length);
  if (current.length !== from.length || current.some((line, i) => line !== from[i]?.text)) {
    gitFail(`error: patch failed: ${path}:${start}\nerror: ${path}: patch does not apply`);
  }
  const endsFile = at + from.length >= lines.length;
  const hadNewline = text === null || text === "" || text.endsWith("\n");
  const newline = endsFile ? !to.some((l) => l.noNewline) : hadNewline;
  const result = [
    ...lines.slice(0, at),
    ...to.map((l) => l.text),
    ...lines.slice(at + from.length),
  ];
  return result.length === 0 ? "" : result.join("\n") + (newline ? "\n" : "");
}

export function fakeStageFile(change: FileChange) {
  // Indexer un gros dossier non suivi créerait 60 modifications « Indexées » : non simulé.
  if (change.repoPath === FOLDED_REPO) gitFail("simulé : indexer le dossier non suivi");
  stagePath(change.repoPath);
}

export function fakeUnstageFile(change: FileChange) {
  unstagePath(change.repoPath);
}

export function fakeStageAll() {
  for (const path of [...store().keys()]) stagePath(path);
}

export function fakeUnstageAll() {
  for (const path of [...store().keys()]) unstagePath(path);
}

export function fakeStageHunk(change: FileChange, hunk: Hunk) {
  if (wholeFile(change)) return fakeStageFile(change);
  const f = fileOf(change.repoPath);
  f.index = applyHunk(change.repoPath, f.index, hunk, false);
}

export function fakeUnstageHunk(change: FileChange, hunk: Hunk) {
  if (wholeFile(change)) return fakeUnstageFile(change);
  const f = fileOf(change.repoPath);
  f.index = applyHunk(change.repoPath, f.index, hunk, true);
}

/** Annule un fichier ; rend le lot de changements du faux disque (`DiskChanged`). */
export function fakeDiscardFile(change: FileChange): DiskChange | null {
  // Dossier non suivi replié : le dossier entier va à la corbeille.
  if (change.repoPath === FOLDED_REPO) return removeFakeNode(FOLDED_DISK);
  const f = fileOf(change.repoPath);
  // Non suivi : corbeille (le fichier quitte le disque) ; suivi : la version indexée revient.
  const disk = setDisk(f, change.repoPath, change.status === "U" ? null : f.index);
  prune(change.repoPath);
  return disk;
}

export function fakeDiscardHunk(change: FileChange, hunk: Hunk): DiskChange | null {
  if (change.status === "U") gitFail("an untracked file is discarded whole (trash)");
  if (change.status === "D") return fakeDiscardFile(change);
  const f = fileOf(change.repoPath);
  return setDisk(
    f,
    change.repoPath,
    applyHunk(change.repoPath, diskOf(f, change.repoPath), hunk, true),
  );
}

/** Committe l'index ; rend un hash court. Un message qui contient « échec » : hook refusé. */
export function fakeCommit(message: string, options: CommitOptions): string {
  if (options.all) fakeStageAll();
  if (message.includes("échec")) {
    gitFail(
      "lint : 3 erreurs\nsrc/main.rs:12:5 : point-virgule manquant\nsrc/main.rs:18:1 : accolade en trop\nhusky - pre-commit script failed (code 1)",
    );
  }
  const keep = options.amend && message.trim() === "";
  if (!keep && message.trim() === "") gitFail("Aborting commit due to empty commit message.");
  if (options.amend && lastMessage === null) gitFail("fatal: You have nothing to amend.");
  const status = fakeStatus();
  if (!options.amend && (status.kind !== "repo" || status.staged.length === 0)) {
    gitFail(`On branch ${BRANCH}\nChanges not staged for commit:\n\nno changes added to commit`);
  }
  for (const [path, f] of [...store()]) {
    f.head = f.index;
    if (f.modes) f.modes.head = f.modes.index;
    delete f.orig;
    prune(path);
  }
  if (!keep) lastMessage = message.replace(/\s+$/, "");
  commitSeq += 1;
  if (!options.amend) noteFakeCommit();
  return (0x3f2a9c1 + commitSeq * 0x1b873).toString(16).slice(-7);
}

export function fakeLastCommitMessage(): string | null {
  return lastMessage;
}

// --- Diff de lignes (plus longue sous-suite commune) -------------------------------------

function splitLines(text: string): string[] {
  if (text === "") return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

const endLine = (start: number, count: number) => (count === 0 ? start : start + count - 1);
const beforeLine = (start: number, count: number) => (count === 0 ? start : start - 1);

function context(oldNumber: number, newNumber: number, text: string): DiffLine {
  return { kind: "context", oldNumber, newNumber, text, noNewline: false, changes: [] };
}

/** Lignes du diff complet, supprimées avant ajoutées dans chaque changement. */
function allLines(a: string[], b: string[]): DiffLine[] {
  // Table des plus longues sous-suites communes, depuis la fin.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] ?? [];
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    out.push(...removed, ...added);
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      out.push(context(i + 1, j + 1, a[i] ?? ""));
      i += 1;
      j += 1;
    } else if (
      j < b.length &&
      (i >= a.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))
    ) {
      added.push({
        kind: "added",
        oldNumber: null,
        newNumber: j + 1,
        text: b[j] ?? "",
        noNewline: false,
        changes: [],
      });
      j += 1;
    } else {
      removed.push({
        kind: "removed",
        oldNumber: i + 1,
        newNumber: null,
        text: a[i] ?? "",
        noNewline: false,
        changes: [],
      });
      i += 1;
    }
  }
  flush();
  return out;
}

/** Plages changées de deux lignes appariées : tout ce qui sépare le début et la fin communs. */
function wordChanges(removed: DiffLine, added: DiffLine) {
  const a = removed.text;
  const b = added.text;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }
  const range = (len: number): CharRange[] =>
    len - end > start ? [{ start, end: len - end }] : [];
  removed.changes = range(a.length);
  added.changes = range(b.length);
}

function markWords(lines: DiffLine[]) {
  let k = 0;
  while (k < lines.length) {
    const removed: DiffLine[] = [];
    while (lines[k]?.kind === "removed") removed.push(lines[k++] as DiffLine);
    const added: DiffLine[] = [];
    while (lines[k]?.kind === "added") added.push(lines[k++] as DiffLine);
    removed.forEach((line, n) => {
      const pair = added[n];
      if (pair) wordChanges(line, pair);
    });
    if (removed.length === 0 && added.length === 0) k += 1;
  }
}

export function textDiff(oldText: string, newText: string): DiffContent {
  if (oldText === newText) return { kind: "identical" };
  const newLines = splitLines(newText);
  const oldLines = splitLines(oldText);
  const lines = allLines(oldLines, newLines);
  // Fin de ligne finale manquante : marquée sur la dernière ligne de la version concernée.
  for (const line of lines) {
    if (!newText.endsWith("\n") && line.kind === "added" && line.newNumber === newLines.length) {
      line.noNewline = true;
    }
    if (!oldText.endsWith("\n") && line.kind === "removed" && line.oldNumber === oldLines.length) {
      line.noNewline = true;
    }
  }
  // Blocs : changements avec 3 lignes de contexte, réunis s'ils se touchent.
  const changed = lines.flatMap((line, i) => (line.kind === "context" ? [] : [i]));
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - CONTEXT);
    const to = Math.min(lines.length - 1, i + CONTEXT);
    const last = ranges.at(-1);
    if (last && from <= last[1] + 1) last[1] = to;
    else ranges.push([from, to]);
  }
  let prevEnd = 0;
  const hunks: Hunk[] = ranges.map(([from, to]) => {
    const hunkLines = lines.slice(from, to + 1);
    markWords(hunkLines);
    const olds = hunkLines.flatMap((l) => (l.oldNumber === null ? [] : [l.oldNumber]));
    const news = hunkLines.flatMap((l) => (l.newNumber === null ? [] : [l.newNumber]));
    // Avec son contexte, un bloc n'a aucune ligne d'un côté que si ce côté est vide : 0.
    const hunk: Hunk = {
      oldStart: olds[0] ?? 0,
      oldCount: olds.length,
      newStart: news[0] ?? 0,
      newCount: news.length,
      hiddenBefore: 0,
      lines: hunkLines,
    };
    hunk.hiddenBefore = Math.max(0, beforeLine(hunk.newStart, hunk.newCount) - prevEnd);
    prevEnd = endLine(hunk.newStart, hunk.newCount);
    return hunk;
  });
  const lineCount = hunks.reduce((n, h) => n + h.lines.length, 0);
  return {
    kind: "text",
    hunks,
    hiddenAfter: Math.max(0, newLines.length - prevEnd),
    lineCount,
    tooLong: lineCount > MAX_DIFF_LINES,
  };
}

// --- Repères du lot 3 (mêmes contrats que `core/src/git/marks.rs`) ---------------------

/** Force d'un statut de repère : conflit, puis non suivi / ajouté / renommé, modifié, supprimé. */
const STRENGTH: Record<ChangeStatus, number> = { "!": 3, U: 2, A: 2, R: 2, M: 1, D: 0 };

function keepStrongest(map: Map<string, ChangeStatus>, path: string, status: ChangeStatus) {
  const current = map.get(path);
  if (current === undefined || STRENGTH[status] > STRENGTH[current]) map.set(path, status);
}

const toMarks = (map: Map<string, ChangeStatus>): PathMark[] =>
  [...map]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, status]) => ({ path, status }));

export function getFakePathStatuses(root: string): PathStatuses {
  const status = getFakeGitStatus(root);
  if (status.kind !== "repo") return { files: [], dirs: [], ignored: [] };
  const files = new Map<string, ChangeStatus>();
  for (const change of [...status.staged, ...status.unstaged]) {
    if (!change.outsideRoot) keepStrongest(files, change.path, change.status);
  }
  const dirs = new Map<string, ChangeStatus>();
  for (const [path, s] of files) {
    for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
      keepStrongest(dirs, path.slice(0, slash), s);
    }
  }
  // `.gitignore` du faux disque : `node_modules` (affiché avec les éléments masqués).
  return { files: toMarks(files), dirs: toMarks(dirs), ignored: ["node_modules"] };
}

/** Texte indexé d'un fichier du dossier racine (`null` : non suivi, conflit, binaire). */
export function getFakeIndexText(root: string, path: string): string | null {
  if (getFakeGitStatus(root).kind !== "repo") return null;
  const repoPath = `${PREFIX}${path}`;
  const f = store().get(repoPath);
  if (f) return f.binary || f.conflict ? null : f.index;
  // Fichier suivi inchangé : le faux disque fait foi.
  const node = findNode(absPath(repoPath));
  return node?.kind === "file" && !node.special ? (node.content ?? "") : null;
}

/** Hash de HEAD du faux dépôt. */
const FAKE_HEAD = "9f3c2a1b7d4e5f60718293a4b5c6d7e8f9012345";

/**
 * Ce que git sait d'un fichier du dossier racine pour son lien GitHub (lot 3 des issues). Suivi :
 * présent dans HEAD (`demo/src/main.rs` et `demo/README.md` sont modifiés, `demo/page10.md` et
 * `demo/docs/nouveau.md` ne sont pas dans HEAD) ; un fichier du faux disque absent du faux
 * dépôt est suivi et intact.
 */
export function getFakeFileLinkInfo(root: string, path: string): FileLinkInfo | null {
  if (getFakeGitStatus(root).kind !== "repo") return null;
  const repoPath = `${PREFIX}${path}`;
  const f = store().get(repoPath);
  if (f) {
    const tracked = f.head !== null;
    return {
      repoPath,
      head: FAKE_HEAD,
      tracked,
      modified: tracked && (f.index !== f.head || diskOf(f, repoPath) !== f.head),
    };
  }
  const node = findNode(absPath(repoPath));
  return { repoPath, head: FAKE_HEAD, tracked: node?.kind === "file", modified: false };
}

/** Blocs de gouttière : diff de lignes simple (plus longue sous-suite commune), fins comprises. */
export function fakeGutterBlocks(indexText: string, editorText: string): GutterBlock[] {
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = split(indexText);
  const b = split(editorText);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] ?? [];
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const blocks: GutterBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const [oldStart, newStart] = [i, j];
    while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j])) {
      if (j < b.length && (i >= a.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
        j += 1;
      } else {
        i += 1;
      }
    }
    const original = a.slice(oldStart, i).join("");
    if (i === oldStart) {
      blocks.push({ kind: "added", startLine: newStart + 1, endLine: j, original });
    } else if (j === newStart) {
      blocks.push({ kind: "deleted", startLine: newStart, endLine: newStart, original });
    } else {
      blocks.push({ kind: "modified", startLine: newStart + 1, endLine: j, original });
    }
  }
  return blocks;
}

export function setFakeGitState(next: MockState) {
  state = next;
  if (next === "repo") {
    files = null;
    resetFakeRemote();
  }
}

/** Le faux dépôt existe (sinon aucun geste réseau). */
export const isFakeRepo = () => state === "repo" || state === "clean";
