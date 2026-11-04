import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import type { Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { findColors } from "@/features/colors/findColors";
import { SWATCH_CLASS } from "@/features/colors/swatch";
import { findIssueRefs } from "@/features/issues/refs";

/**
 * Chaîne de rendu Markdown. HTML brut interprété (`rehype-raw`) puis nettoyé avec le schéma
 * de GitHub (`rehype-sanitize`, docs/decisions/0004-html-brut-markdown.md), puis pastilles de
 * couleur, ajoutées après le nettoyage : leur attribut `style` serait sinon retiré.
 * Tableaux constants : `react-markdown` ne refait pas la chaîne à chaque rendu.
 */
export const REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm];
export const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  rehypeRaw,
  rehypeSanitize,
  rehypeColorSwatches,
];

/**
 * Même chaîne, plus les références d'issue : chaque `#123` du texte devient un lien
 * `<a data-issue-ref="123">` (spec issues-github.md, lot 3). Les `components` `a` des vues qui
 * l'utilisent ouvrent l'issue. À réserver aux dépôts GitHub connus.
 */
export const REHYPE_PLUGINS_WITH_ISSUES: NonNullable<Options["rehypePlugins"]> = [
  ...REHYPE_PLUGINS,
  rehypeIssueRefs,
];

/**
 * Pas de pastille dans un lien (son texte est souvent son adresse) ni dans un bloc de code
 * (`CodeBlock` les pose sur ses jetons colorés).
 */
const SKIPPED = new Set(["a", "pre"]);

function swatch(color: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [SWATCH_CLASS],
      dataColorSwatch: "",
      ariaHidden: "true",
      style: `background-color: ${color}`,
    },
    children: [],
  };
}

/** Un texte découpé avec une pastille devant chaque couleur ; tel quel s'il n'en a pas. */
function splitText(node: Text): ElementContent[] {
  const colors = findColors(node.value);
  if (colors.length === 0) return [node];
  const parts: ElementContent[] = [];
  let last = 0;
  for (const { start, value } of colors) {
    if (start > last) parts.push({ type: "text", value: node.value.slice(last, start) });
    parts.push(swatch(value));
    last = start;
  }
  parts.push({ type: "text", value: node.value.slice(last) });
  return parts;
}

function addSwatches(parent: Root | Element) {
  // Seuls des textes sont remplacés (par des textes et des éléments) : le type reste valide.
  (parent as Root).children = parent.children.flatMap((child): RootContent[] => {
    if (child.type === "text") return splitText(child);
    if (child.type === "element" && !SKIPPED.has(child.tagName)) addSwatches(child);
    return [child];
  });
}

/** Plugin rehype : pastille devant chaque couleur du texte (spec pastilles-couleur.md). */
function rehypeColorSwatches() {
  return (tree: Root) => addSwatches(tree);
}

/** Pas de référence dans un lien (déjà cliquable), du code en ligne ou un bloc de code. */
const ISSUE_SKIPPED = new Set(["a", "pre", "code"]);

/** Un texte découpé avec un lien devant chaque `#123` ; tel quel s'il n'en a pas. */
function splitIssueRefs(node: Text): ElementContent[] {
  const refs = findIssueRefs(node.value);
  if (refs.length === 0) return [node];
  const parts: ElementContent[] = [];
  let last = 0;
  for (const { start, end, number } of refs) {
    if (start > last) parts.push({ type: "text", value: node.value.slice(last, start) });
    parts.push({
      type: "element",
      tagName: "a",
      properties: { href: "#", dataIssueRef: String(number), className: ["issue-ref"] },
      children: [{ type: "text", value: node.value.slice(start, end) }],
    });
    last = end;
  }
  if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
  return parts;
}

function addIssueRefs(parent: Root | Element) {
  (parent as Root).children = parent.children.flatMap((child): RootContent[] => {
    if (child.type === "text") return splitIssueRefs(child);
    if (child.type === "element" && !ISSUE_SKIPPED.has(child.tagName)) addIssueRefs(child);
    return [child];
  });
}

/** Plugin rehype : lien devant chaque `#123` du texte (spec issues-github.md, lot 3). */
function rehypeIssueRefs() {
  return (tree: Root) => addIssueRefs(tree);
}
