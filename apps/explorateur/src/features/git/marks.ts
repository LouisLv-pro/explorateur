// Repères git (docs/specs/git.md, lot 3) : couleur et lettre d'une entrée de l'arborescence ou
// d'un onglet, point d'un dossier, et « Annuler ce bloc » de la gouttière. Fonctions pures.
import type { ChangeStatus, GitSnapshot, GutterBlock, PathStatuses, RepoStatus } from "@/bindings";
import i18n from "@/i18n";

/** Libellé et couleurs d'un statut (lettre, nom, point d'un dossier). */
export const STATUS_STYLE: Record<ChangeStatus, { label: string; text: string; dot: string }> = {
  // `label` est un getter : traduit à la lecture, jamais figé à l'import.
  M: {
    get label() {
      return i18n.t("git:status.M");
    },
    text: "text-vcs-modified",
    dot: "bg-vcs-modified",
  },
  A: {
    get label() {
      return i18n.t("git:status.A");
    },
    text: "text-vcs-added",
    dot: "bg-vcs-added",
  },
  D: {
    get label() {
      return i18n.t("git:status.D");
    },
    text: "text-vcs-deleted",
    dot: "bg-vcs-deleted",
  },
  R: {
    get label() {
      return i18n.t("git:status.R");
    },
    text: "text-vcs-modified",
    dot: "bg-vcs-modified",
  },
  U: {
    get label() {
      return i18n.t("git:status.U");
    },
    text: "text-vcs-untracked",
    dot: "bg-vcs-untracked",
  },
  "!": {
    get label() {
      return i18n.t("git:status.conflict");
    },
    text: "text-vcs-conflict",
    dot: "bg-vcs-conflict",
  },
};

/** Repères indexés par chemin relatif au dossier racine. */
export type MarkIndex = {
  files: ReadonlyMap<string, ChangeStatus>;
  dirs: ReadonlyMap<string, ChangeStatus>;
  ignored: ReadonlySet<string>;
  /** Dossiers non suivis repliés (sans `/` final) : tout ce qui est dessous est `U`. */
  folded: ReadonlySet<string>;
  /** Le dossier racine est dans un dossier non suivi replié : toutes ses entrées sont `U`. */
  rootUntracked: boolean;
};

export const NO_MARKS: MarkIndex = {
  files: new Map(),
  dirs: new Map(),
  ignored: new Set(),
  folded: new Set(),
  rootUntracked: false,
};

export function markIndex(statuses: PathStatuses, rootUntracked = false): MarkIndex {
  return {
    files: new Map(statuses.files.map((m) => [m.path, m.status])),
    dirs: new Map(statuses.dirs.map((m) => [m.path, m.status])),
    ignored: new Set(statuses.ignored),
    folded: new Set(
      statuses.files.filter((m) => m.path.endsWith("/")).map((m) => m.path.slice(0, -1)),
    ),
    rootUntracked,
  };
}

/**
 * Le statut liste-t-il un dossier non suivi replié qui contient le dossier racine (hors du
 * dossier, chemin à `/` final) ? Alors les repères sont vides et tout est `U`.
 */
export function rootInFoldedDir(status: RepoStatus): boolean {
  if (status.kind !== "repo") return false;
  return [...status.staged, ...status.unstaged].some(
    (c) => c.outsideRoot && c.status === "U" && c.path.endsWith("/"),
  );
}

// Une seule indexation par réponse de Rust, quel que soit le nombre de lignes qui la lisent.
const indexes = new WeakMap<GitSnapshot, MarkIndex>();

/** Repères d'une réponse de `get_git_status` (repères et dossier racine dans un dossier replié). */
export function snapshotMarks(snapshot: GitSnapshot): MarkIndex {
  let index = indexes.get(snapshot);
  if (!index) {
    index = markIndex(snapshot.marks, rootInFoldedDir(snapshot.status));
    indexes.set(snapshot, index);
  }
  return index;
}

/** Repère d'une entrée : statut (fichier modifié, ou dossier qui en contient), ou ignorée. */
export type EntryMark = {
  status: ChangeStatus | null;
  ignored: boolean;
};

/** Ignorée elle-même, ou dans un dossier ignoré (donné seul par Rust). */
export function isIgnored(index: MarkIndex, rel: string): boolean {
  return hasSelfOrAncestor(index.ignored, rel);
}

/** Sous un dossier non suivi replié (le dossier lui-même compris). */
export function isUnderFolded(index: MarkIndex, rel: string): boolean {
  return hasSelfOrAncestor(index.folded, rel);
}

/** `rel` ou un de ses dossiers parents est dans `set` (chemins relatifs, séparés par `/`). */
function hasSelfOrAncestor(set: ReadonlySet<string>, rel: string): boolean {
  if (set.size === 0) return false;
  for (let path = rel; ;) {
    if (set.has(path)) return true;
    const slash = path.lastIndexOf("/");
    if (slash < 0) return false;
    path = path.slice(0, slash);
  }
}

/**
 * Repère de l'entrée `path` (absolu) sous le dossier racine `root`. Un fichier prend son statut,
 * un dossier le statut le plus fort de ses fichiers (son point), une entrée sous un dossier non
 * suivi replié est `U`.
 */
export function entryMark(index: MarkIndex, root: string, path: string, isDir: boolean): EntryMark {
  const base = root.endsWith("/") ? root : `${root}/`;
  if (!path.startsWith(base)) return { status: null, ignored: false };
  if (index.rootUntracked) return { status: "U", ignored: false };
  const rel = path.slice(base.length);
  const status =
    (isDir ? index.dirs : index.files).get(rel) ?? (isUnderFolded(index, rel) ? "U" : null);
  return { status, ignored: status === null && isIgnored(index, rel) };
}

/** Classe de couleur du nom d'une entrée : statut, sinon gris si ignorée, sinon rien. */
export function nameClass(mark: EntryMark): string | null {
  if (mark.status !== null) return STATUS_STYLE[mark.status].text;
  return mark.ignored ? "text-vcs-ignored" : null;
}

/** Modification d'un texte : remplacer `from..to` (positions de caractères) par `insert`. */
export type TextChange = { from: number; to: number; insert: string };

/** Position du début de chaque ligne (1-indexée : `starts[n - 1]`), plus la fin du texte. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  // Dernière ligne sans fin : sa fin est celle du texte.
  if (starts.at(-1) !== text.length) starts.push(text.length);
  return starts;
}

/**
 * « Annuler ce bloc » : modification qui rend au texte de l'éditeur la version indexée du bloc.
 * Ajout ou modification : les lignes `startLine..=endLine` (fins comprises) deviennent
 * `original` ; suppression : `original` est inséré avant la ligne `startLine + 1`.
 */
export function revertBlock(text: string, block: GutterBlock): TextChange {
  const starts = lineStarts(text);
  const at = (line: number) => starts[Math.min(Math.max(line, 0), starts.length - 1)] ?? 0;
  if (block.kind === "deleted") {
    const pos = at(block.startLine);
    return { from: pos, to: pos, insert: block.original };
  }
  return { from: at(block.startLine - 1), to: at(block.endLine), insert: block.original };
}

/** Applique une modification à un texte. */
export function applyChange(text: string, change: TextChange): string {
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}
