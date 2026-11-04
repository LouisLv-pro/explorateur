// Fonctions pures du volet Modifications (docs/specs/git.md, lot 1) : liste, mode Scindé,
// mots surlignés posés dans les jetons colorés.
import type { CharRange, DiffLine, Entry, FileChange, RepoStatus } from "@/bindings";
import { previewKindOf } from "@/features/quick-open/match";

/** Clé d'une modification : un fichier indexé puis modifié a deux lignes, deux diffs. */
export function changeKey(change: FileChange): string {
  return `${change.staged ? "staged" : "unstaged"}:${change.repoPath}`;
}

/** Nombre de fichiers modifiés (un fichier indexé puis modifié compte une fois). */
export function changedFileCount(status: RepoStatus | undefined): number {
  if (status?.kind !== "repo") return 0;
  return new Set([...status.staged, ...status.unstaged].map((c) => c.repoPath)).size;
}

/** Modifications dans l'ordre de la liste : « Indexées », puis « Modifications ». */
export function listOrder(status: RepoStatus | undefined): FileChange[] {
  return status?.kind === "repo" ? [...status.staged, ...status.unstaged] : [];
}

/**
 * Nom et dossier parent (vide à la racine) d'un chemin affiché. Un dossier non suivi replié
 * (`a/gen/`) garde sa barre finale dans son nom (`gen/`).
 */
export function splitPath(path: string): { name: string; dir: string } {
  const trailing = path.endsWith("/") ? "/" : "";
  const bare = trailing ? path.slice(0, -1) : path;
  const slash = bare.lastIndexOf("/");
  return slash < 0
    ? { name: bare + trailing, dir: "" }
    : { name: bare.slice(slash + 1) + trailing, dir: bare.slice(0, slash) };
}

/** Dossier non suivi replié (plus de 50 fichiers) : une seule modification, chemin à `/` final. */
export function isFoldedDir(change: FileChange): boolean {
  return change.status === "U" && change.path.endsWith("/");
}

/** Dossier non suivi replié qui contient le dossier racine (l'annuler le mettrait à la corbeille). */
export function containsRoot(change: FileChange): boolean {
  return isFoldedDir(change) && change.outsideRoot;
}

/**
 * Vrai si le fichier peut s'ouvrir en onglet : ni supprimé, ni dossier non suivi, ni hors du
 * dossier racine.
 */
export function canOpen(change: FileChange): boolean {
  return change.status !== "D" && !change.outsideRoot && !isFoldedDir(change);
}

/** Geste du lot 2 sur un fichier ou un bloc. */
export type ChangeAction = "discard" | "stage" | "unstage";

/**
 * Gestes proposés, dans l'ordre des boutons : « Désindexer » dans « Indexées » ; « Annuler les
 * modifications » et « Indexer » dans « Modifications » ; un conflit, seulement « Indexer » ;
 * un dossier non suivi qui contient le dossier racine, aucun.
 */
export function changeActions(change: FileChange): ChangeAction[] {
  if (change.staged) return ["unstage"];
  if (containsRoot(change)) return [];
  if (change.status === "!") return ["stage"];
  return ["discard", "stage"];
}

/** Entrée équivalente pour `openFile` (chemin absolu sous le dossier racine). */
export function entryOfChange(change: FileChange, rootPath: string): Entry {
  const { name } = splitPath(change.path);
  const base = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  if (isFoldedDir(change)) {
    return { name: name.slice(0, -1), path: base + change.path, is_dir: true, preview_kind: null };
  }
  return { name, path: base + change.path, is_dir: false, preview_kind: previewKindOf(name) };
}

/** Une rangée du mode Scindé : ancienne ligne à gauche, nouvelle à droite (absente : vide). */
export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/**
 * Aligne les lignes d'un bloc pour le mode Scindé : le contexte des deux côtés ; dans une suite
 * de lignes supprimées suivie de lignes ajoutées, la i-ème supprimée face à la i-ème ajoutée,
 * le surplus face à une case vide.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "context") {
      flush();
      rows.push({ left: line, right: line });
    } else if (line.kind === "removed") {
      // Une supprimée après des ajoutées ouvre une nouvelle suite.
      if (added.length > 0) flush();
      removed.push(line);
    } else {
      added.push(line);
    }
  }
  flush();
  return rows;
}

/** Jeton coloré (sous-ensemble d'un jeton Shiki). */
export type ColoredToken = { content: string; color?: string; fontStyle?: number };

/** Morceau de ligne : jeton (ou partie de jeton), surligné s'il est dans une plage changée. */
export type Segment = ColoredToken & { changed: boolean };

/**
 * Coupe les jetons d'une ligne aux bornes des plages changées (indices UTF-16, comme les
 * chaînes JavaScript). Le texte rendu est inchangé : seuls les morceaux changés sont marqués.
 */
export function markChanges(
  tokens: readonly ColoredToken[],
  changes: readonly CharRange[],
): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const start = offset;
    const end = start + token.content.length;
    offset = end;
    // Bornes des plages dans ce jeton, triées.
    const cuts = new Set<number>([start, end]);
    for (const range of changes) {
      if (range.start > start && range.start < end) cuts.add(range.start);
      if (range.end > start && range.end < end) cuts.add(range.end);
    }
    const bounds = [...cuts].sort((a, b) => a - b);
    for (const [k, from] of bounds.slice(0, -1).entries()) {
      const to = bounds[k + 1] ?? end;
      const changed = changes.some((range) => range.start <= from && to <= range.end);
      const content = token.content.slice(from - start, to - start);
      const last = segments.at(-1);
      // Morceaux voisins de même style et même marque : réunis.
      if (
        last &&
        last.changed === changed &&
        last.color === token.color &&
        last.fontStyle === token.fontStyle
      ) {
        last.content += content;
      } else {
        segments.push({ ...token, content, changed });
      }
    }
  }
  return segments;
}

/** Rang de la première ligne de chaque bloc dans la suite de toutes les lignes du diff. */
export function hunkStarts(hunks: readonly { lines: readonly unknown[] }[]): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const hunk of hunks) {
    starts.push(next);
    next += hunk.lines.length;
  }
  return starts;
}

/** Ligne masquée ou ligne d'un bloc : texte à colorer de l'ancienne ou de la nouvelle version. */
export type Side = "old" | "new";

/**
 * Texte de chaque version reconstitué à partir des lignes : l'ancienne (contexte et supprimées)
 * et la nouvelle (contexte et ajoutées), pour les colorer d'un seul appel par version. Rend aussi,
 * pour chaque ligne, son rang dans le texte de sa version.
 */
export function sideTexts(lines: readonly DiffLine[]): {
  old: string;
  new: string;
  index: { side: Side; row: number }[];
} {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const index = lines.map((line) => {
    if (line.kind === "removed") return { side: "old" as const, row: oldLines.push(line.text) - 1 };
    if (line.kind === "added") return { side: "new" as const, row: newLines.push(line.text) - 1 };
    oldLines.push(line.text);
    return { side: "new" as const, row: newLines.push(line.text) - 1 };
  });
  return { old: oldLines.join("\n"), new: newLines.join("\n"), index };
}
