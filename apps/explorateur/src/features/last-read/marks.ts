import type { ReadMarks } from "@/bindings";

/** Pastilles indexées pour une recherche par chemin. */
export type ReadMarkSets = { files: ReadonlySet<string>; dirs: ReadonlySet<string> };

/** `select` de la requête : stable au niveau du module, TanStack le mémorise. */
export function toMarkSets(marks: ReadMarks): ReadMarkSets {
  return { files: new Set(marks.files), dirs: new Set(marks.dirs) };
}

/** Point d'une entrée : fichier listé, ou dossier replié qui contient un fichier listé. */
export function readDot(
  sets: ReadMarkSets | undefined,
  path: string,
  isDir: boolean,
  open: boolean,
): "file" | "dir" | null {
  if (!sets) return null;
  if (!isDir) return sets.files.has(path) ? "file" : null;
  return !open && sets.dirs.has(path) ? "dir" : null;
}

/** Résumé du bandeau : `+N −M` (signe moins U+2212, comme le volet Modifications). */
export function lineSummary(added: number, removed: number): string {
  return `+${added} −${removed}`;
}
