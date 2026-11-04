// Modifié depuis votre dernière lecture (docs/specs/derniere-lecture.md) sur le faux disque :
// mêmes règles que `core/src/last_read/` (version lue en mémoire, « jamais lu » touché, éléments
// masqués exclus), sans plafond de texte ; diff de mock-git.ts.
import type { Entry, ReadMarks, ReadOutcome } from "@/bindings";
import { findNode, isHidden, openFakeFile } from "./mock-disk";
import { textDiff } from "./mock-git";

type Version = { revision: string; text: string | null };

let root: string | null = null;
const versions = new Map<string, Version>();
/** Fichiers lus dont le disque diffère de la version lue. */
const changed = new Set<string>();
/** Fichiers jamais lus touchés depuis l'ouverture du dossier racine. */
const touched = new Set<string>();

/** Version actuelle d'un fichier : révision, et texte si l'aperçu le lit en texte. */
function currentVersion(path: string): Version {
  const preview = openFakeFile(path);
  const text = "text" in preview.content ? preview.content.text : null;
  return { revision: preview.revision, text };
}

/** Segments de `path` sous le dossier racine, ou `null` s'il n'est pas dessous. */
function segmentsUnderRoot(path: string): string[] | null {
  if (root === null) return null;
  const prefix = root === "/" ? "/" : `${root}/`;
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length).split("/").filter(Boolean);
}

const isUnder = (path: string, dir: string) => path.startsWith(dir === "/" ? "/" : `${dir}/`);

export function setFakeReadRoot(path: string) {
  root = path;
  touched.clear();
}

/** Comme `note_changes` : appelé avec les `files` de chaque `DiskChanged`, avant l'émission. */
export function noteFakeChanges(files: readonly string[]) {
  for (const path of files) {
    const exists = findNode(path)?.kind === "file";
    const version = versions.get(path);
    if (version) {
      const current = exists ? currentVersion(path) : null;
      const differs =
        current !== null &&
        current.revision !== version.revision &&
        (version.text === null || current.text !== version.text);
      if (differs) changed.add(path);
      else changed.delete(path);
      continue;
    }
    const segments = segmentsUnderRoot(path);
    const hidden = segments?.some((name, i) =>
      isHidden({ name, is_dir: i < segments.length - 1 } as Entry),
    );
    if (exists && segments && segments.length > 0 && !hidden) touched.add(path);
    else touched.delete(path);
  }
}

/** Comme `mark_read` : `NotFound` (levé par `openFakeFile`) si le fichier est absent. */
export function markFakeRead(path: string): ReadOutcome {
  const current = currentVersion(path);
  const wasTouched = touched.delete(path);
  changed.delete(path);
  const old = versions.get(path);
  versions.set(path, current);
  if (!old) return { kind: "FirstRead", touched: wasTouched };
  if (old.revision === current.revision) return { kind: "Unchanged" };
  if (old.text === null || current.text === null) return { kind: "ChangedNoDiff" };
  if (old.text === current.text) return { kind: "Unchanged" };
  const diff = textDiff(old.text, current.text);
  const lines = diff.kind === "text" ? diff.hunks.flatMap((h) => h.lines) : [];
  return {
    kind: "Changed",
    diff,
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
}

/** Comme `marks(root)` : chemins absolus triés, dossiers ancêtres sous la racine. */
export function fakeReadMarks(rootPath: string): ReadMarks {
  const files = [...new Set([...changed, ...touched])].filter((p) => isUnder(p, rootPath)).sort();
  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = file.slice(0, file.lastIndexOf("/")); isUnder(dir, rootPath);) {
      dirs.add(dir);
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
  }
  return { files, dirs: [...dirs].sort() };
}
