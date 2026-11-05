import type { Entry, FileHits, FileMatch, PreviewKind } from "@/bindings";

/** Extensions par type d'aperçu (miroir de `PreviewKind::from_name` en Rust). */
const KIND_BY_EXTENSION: Record<string, PreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  mmd: "mermaid",
  mermaid: "mermaid",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  pdf: "pdf",
  ipynb: "notebook",
};

export function previewKindOf(name: string): PreviewKind {
  const dot = name.lastIndexOf(".");
  return (dot > 0 && KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || "text";
}

/** Nom du fichier et dossier parent (sans `/` final) d'un chemin relatif. */
export function splitRelative(relative: string): { name: string; dir: string } {
  const slash = relative.lastIndexOf("/");
  return slash < 0
    ? { name: relative, dir: "" }
    : { name: relative.slice(slash + 1), dir: relative.slice(0, slash) };
}

/** Requête de ⌘P : le texte à chercher et la ligne à ouvrir (`null` : aucune). */
export type ParsedQuery = { text: string; line: number | null };

const LINE_SUFFIX = /^(.*):(\d+)\s*$/;

/**
 * Sépare un suffixe `:ligne` (`main.rs:42`) de la requête. `:0`, `:` seul, `:b` ou `: 4` ne sont
 * pas une ligne : la requête est cherchée telle quelle. Rien avant `:` (`:42`) : texte vide.
 */
export function parseQuery(query: string): ParsedQuery {
  const found = LINE_SUFFIX.exec(query);
  if (found) {
    const line = Number(found[2]);
    if (Number.isSafeInteger(line) && line >= 1) return { text: found[1] ?? "", line };
  }
  return { text: query, line: null };
}

/** Entrée de l'arborescence équivalente à un résultat (⌘P ou ⌘⇧F), pour `openFile`. */
export function entryOf(match: FileMatch | FileHits): Entry {
  const { name } = splitRelative(match.relative_path);
  return { name, path: match.path, is_dir: false, preview_kind: previewKindOf(name) };
}

/** Morceau de nom, en gras ou non. */
export type Segment = { text: string; bold: boolean };

/**
 * Découpe `name` en morceaux selon les lettres à mettre en gras. `matched` indexe le chemin
 * relatif entier (en caractères) ; le nom commence à `offset`.
 */
export function highlightSegments(name: string, offset: number, matched: number[]): Segment[] {
  const bold = new Set(matched);
  const segments: Segment[] = [];
  let i = offset;
  for (const char of name) {
    const isBold = bold.has(i++);
    const last = segments.at(-1);
    if (last && last.bold === isBold) last.text += char;
    else segments.push({ text: char, bold: isBold });
  }
  return segments;
}
