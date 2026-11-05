import type { FilePreview, PreviewContent } from "@/bindings";
import { dataFormat } from "./data/formats";

/** Affichage d'un fichier Markdown, HTML, Mermaid ou de données : rendu, côte à côte, source. */
export type DisplayMode = "rendered" | "split" | "source";

/** Un mode par type, valable pour tous les fichiers de ce type de la session. */
export type DisplayModes = {
  markdown: DisplayMode;
  html: DisplayMode;
  // Facultatifs : display.test.ts (existant, non modifié) bâtit des `DisplayModes` sans eux.
  mermaid?: DisplayMode;
  /** CSV, TSV, JSON et YAML (docs/specs/apercu-donnees.md) : un seul mode pour les quatre. */
  data?: DisplayMode;
  /** Notebooks Jupyter (docs/specs/notebook.md) : Aperçu ou Source, jamais Scindé. */
  notebook?: DisplayMode;
};

export const DEFAULT_MODES: DisplayModes = {
  markdown: "rendered",
  html: "rendered",
  mermaid: "rendered",
  data: "rendered",
  notebook: "rendered",
};

/**
 * Type de vue : le type d'aperçu de Rust, ou `Data` pour un fichier texte dont le nom est celui
 * d'un format de données (le type Rust reste `Text`).
 */
export type ViewKind = PreviewContent["kind"] | "Data";

/** Type de vue d'un aperçu. */
export function viewKind(preview: FilePreview): ViewKind {
  const { kind } = preview.content;
  return kind === "Text" && dataFormat(preview.name) !== undefined ? "Data" : kind;
}

/** Les trois boutons Aperçu, Scindé, Source (une grosse page HTML n'a que l'aperçu : voir `Preview`). */
export function hasDisplayModes(kind: ViewKind): boolean {
  return (
    kind === "Markdown" ||
    kind === "Html" ||
    kind === "Mermaid" ||
    kind === "Data" ||
    kind === "Notebook"
  );
}

/**
 * Mode à changer par ⌥⌘1, ⌥⌘2, ⌥⌘3, comme le bouton du mode : celui du Markdown, du HTML, de
 * Mermaid ou des données, ou `null` (autre type, ou Scindé et Source d'une grosse page HTML, dont
 * les boutons sont inactifs).
 */
export function modeTarget(kind: ViewKind, mode: DisplayMode): keyof DisplayModes | null {
  if (kind === "Markdown") return "markdown";
  if (kind === "Mermaid") return "mermaid";
  if (kind === "Data") return "data";
  if (kind === "Html") return "html";
  if (kind === "LargeHtml" && mode === "rendered") return "html";
  if (kind === "Notebook" && mode !== "split") return "notebook";
  return null;
}

/** Mode à appliquer à un contenu : Markdown, HTML, Mermaid et données suivent leur mode, le reste est rendu. */
export function displayFor(kind: ViewKind, modes: DisplayModes): DisplayMode {
  if (kind === "Markdown") return modes.markdown;
  if (kind === "Mermaid") return modes.mermaid ?? "rendered";
  if (kind === "Data") return modes.data ?? "rendered";
  if (kind === "Html") return modes.html;
  if (kind === "Notebook") return modes.notebook === "source" ? "source" : "rendered";
  return "rendered";
}
