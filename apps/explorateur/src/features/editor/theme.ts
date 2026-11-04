import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import i18n from "@/i18n";

/**
 * Thème de l'éditeur, écrit avec les variables CSS de DESIGN.md (`src/theme.css`) :
 * il suit le mode sombre sans second thème. La sélection est celle du navigateur (pas de
 * `drawSelection`) : `::selection` de `theme.css` donne `selection-bg` et `selection-fg`.
 */
export const editorTheme = EditorView.theme({
  "&": {
    flex: "1 1 0",
    minWidth: "0",
    minHeight: "0",
    height: "100%",
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-ink)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-code)",
    lineHeight: "var(--text-code--line-height)",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-ink)" },
  ".cm-line": { padding: "0 16px 0 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-mute)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
  // Gouttière git (spec git.md, lot 3) : barres et triangle à droite des numéros de ligne.
  ".cm-git-gutter": { width: "6px", marginRight: "4px" },
  ".cm-git-gutter .cm-gutterElement": { cursor: "pointer" },
  ".cm-git-mark": { position: "relative", width: "3px", height: "100%" },
  ".cm-git-added": { backgroundColor: "var(--color-vcs-added)" },
  ".cm-git-modified": { backgroundColor: "var(--color-vcs-modified)" },
  ".cm-git-deleted::after, .cm-git-deleted-top::after": {
    content: '""',
    position: "absolute",
    left: "0",
    borderLeft: "6px solid var(--color-vcs-deleted)",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
  },
  ".cm-git-deleted::after": { bottom: "-4px" },
  ".cm-git-deleted-top::after": { top: "-4px" },
  // Bloc d'origine affiché sous ses lignes.
  ".cm-git-block": {
    backgroundColor: "var(--color-diff-removed)",
    borderTop: "1px solid var(--color-hairline)",
    borderBottom: "1px solid var(--color-hairline)",
    // Pas de marge : CodeMirror mesure la hauteur du widget sans elle (numéros décalés).
    padding: "6px 16px 8px 8px",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-caption)",
    color: "var(--color-ink)",
  },
  ".cm-git-block-text": {
    margin: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-code)",
    lineHeight: "var(--text-code--line-height)",
    whiteSpace: "pre",
    overflowX: "auto",
  },
  ".cm-git-block-note": { margin: "0", color: "var(--color-body)" },
  ".cm-git-block-actions": { display: "flex", gap: "6px", marginTop: "6px" },
  ".cm-git-block .cm-button": { margin: "0", cursor: "default" },
  ".cm-flash-line": { backgroundColor: "var(--color-warning-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--color-warning-soft)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--color-link-bg-soft)" },
  // Panneau de recherche (⌘F).
  ".cm-panels": {
    backgroundColor: "var(--color-canvas-soft)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-caption)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-hairline)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--color-hairline)" },
  ".cm-panel.cm-search": { padding: "6px 32px 6px 12px" },
  ".cm-panel.cm-search label": { color: "var(--color-body)", fontSize: "var(--text-caption)" },
  // Champ « Aller à la ligne » (⌥⌘G), même apparence que le panneau de recherche.
  ".cm-panel.cm-dialog": { padding: "6px 32px 6px 12px" },
  ".cm-panel.cm-dialog label": { color: "var(--color-body)", fontSize: "var(--text-caption)" },
  ".cm-dialog-close": {
    color: "var(--color-mute)",
    fontSize: "var(--text-body-md)",
    cursor: "default",
  },
  ".cm-textfield": {
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-ink)",
    border: "1px solid var(--color-hairline-strong)",
    borderRadius: "var(--radius-sm)",
    padding: "2px 6px",
    fontSize: "var(--text-caption)",
  },
  ".cm-textfield:focus": { outline: "2px solid var(--color-link)", outlineOffset: "-1px" },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-ink)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-sm)",
    padding: "2px 8px",
    fontSize: "var(--text-caption)",
  },
  ".cm-button:active": { backgroundImage: "none", backgroundColor: "var(--color-canvas-soft-2)" },
  ".cm-panel.cm-search [name=close]": {
    color: "var(--color-mute)",
    fontSize: "var(--text-body-md)",
  },
});

/** Couleur d'un rôle de syntaxe de DESIGN.md (`--color-syntax-*`, mêmes rôles que Shiki). */
const role = (name: string) => `var(--color-syntax-${name})`;

/**
 * Couleurs de syntaxe (spec couleurs-syntaxe.md). Variables, ponctuation et opérateurs gardent
 * la couleur du texte. Une étiquette plus précise (`t.self`, `t.unit`, `t.function(…)`)
 * l'emporte sur son parent (`t.keyword`, `t.propertyName`).
 */
export const highlightStyle = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.moduleKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.modifier,
      t.self,
      t.logicOperator,
    ],
    color: role("keyword"),
  },
  {
    tag: [t.string, t.special(t.string), t.docString, t.regexp, t.character, t.attributeValue],
    color: role("string"),
  },
  {
    tag: [
      t.number,
      t.integer,
      t.float,
      t.bool,
      t.null,
      t.atom,
      t.unit,
      t.escape,
      t.color,
      t.constant(t.name),
      t.constant(t.variableName),
      t.standard(t.variableName),
    ],
    color: role("number"),
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
      t.definition(t.function(t.variableName)),
    ],
    color: role("function"),
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)],
    color: role("type"),
  },
  {
    tag: [t.propertyName, t.definition(t.propertyName), t.attributeName, t.labelName],
    color: role("property"),
  },
  { tag: [t.tagName, t.standard(t.tagName)], color: role("tag") },
  { tag: [t.macroName, t.annotation, t.meta], color: role("macro") },
  { tag: [t.link, t.url], color: "var(--color-link)", textDecoration: "underline" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: role("comment"),
    fontStyle: "italic",
  },
  // Marques de Markdown (`#`, `*`, `>`…) : discrètes, comme avant.
  { tag: t.processingInstruction, color: "var(--color-mute)", fontStyle: "italic" },
  { tag: t.heading, color: "var(--color-ink)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "var(--color-error)" },
]);

/**
 * Textes de CodeMirror (panneau de recherche, aller à la ligne, caractères de contrôle) dans la
 * langue active : la clé est le texte anglais d'origine de CodeMirror. Lu à l'appel, donc à
 * mettre dans un `Compartment` que l'éditeur reconfigure au changement de langue.
 */
export function editorPhrases(): Record<string, string> {
  const tr = i18n.getFixedT(null, "editor", "codemirror");
  return {
    Find: tr("find"),
    Replace: tr("replace"),
    next: tr("next"),
    previous: tr("previous"),
    all: tr("all"),
    "match case": tr("matchCase"),
    "by word": tr("byWord"),
    regexp: tr("regexp"),
    replace: tr("replaceOne"),
    "replace all": tr("replaceAll"),
    close: tr("close"),
    "current match": tr("currentMatch"),
    "replaced $ matches": tr("replacedMatches"),
    "replaced match on line $": tr("replacedMatchOnLine"),
    "on line": tr("onLine"),
    "Go to line": tr("goToLine"),
    go: tr("go"),
    "Control character": tr("controlCharacter"),
    "Selection deleted": tr("selectionDeleted"),
  };
}
