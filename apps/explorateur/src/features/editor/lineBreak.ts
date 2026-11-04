/** Fin de ligne d'un fichier : CodeMirror travaille en `\n`, le fichier peut être en `\r\n`. */
export type LineBreak = "\n" | "\r\n";

/** Fin de ligne d'un texte d'après sa première ligne ; `\n` sans fin de ligne. */
export function detectLineBreak(text: string): LineBreak {
  const index = text.indexOf("\n");
  return index > 0 && text[index - 1] === "\r" ? "\r\n" : "\n";
}

/** Texte en `\n` (celui de l'éditeur) → texte à écrire, avec la fin de ligne `lineBreak`. */
export function withLineBreak(text: string, lineBreak: LineBreak): string {
  return lineBreak === "\n" ? text : text.replace(/\r?\n/g, "\r\n");
}

/** Texte lu → texte de l'éditeur : toutes les fins de ligne en `\n`, comme CodeMirror. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
