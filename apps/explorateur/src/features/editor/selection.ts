// Lignes sélectionnées d'un éditeur (spec issues-github.md, lot 3). Fonction pure sur le texte
// du document (fins de ligne en `\n`) et des positions de caractères, comme CodeMirror.

/** Lignes (à partir de 1) touchées par une sélection, et leur texte. */
export type SelectedLines = { start: number; end: number; text: string };

/**
 * Lignes de la sélection `from`..`to`, ou la ligne du curseur sans sélection. Une sélection qui
 * finit au tout début d'une ligne (triple clic, lignes entières) n'inclut pas cette ligne.
 */
export function selectedLines(text: string, from: number, to: number): SelectedLines {
  const a = Math.max(0, Math.min(from, to, text.length));
  const b = Math.min(text.length, Math.max(from, to));
  // Fin exclue au début d'une ligne : on s'arrête au caractère d'avant.
  const last = b > a && text[b - 1] === "\n" ? b - 1 : b;
  const lines = text.split("\n");
  const lineAt = (position: number) => text.slice(0, position).split("\n").length;
  const start = lineAt(a);
  const end = Math.max(start, lineAt(last));
  return { start, end, text: lines.slice(start - 1, end).join("\n") };
}
