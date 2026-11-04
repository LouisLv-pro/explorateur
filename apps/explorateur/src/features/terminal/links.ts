// Liens du terminal (docs/specs/terminal.md, lot 2) : URL `http(s)` trouvées ici, chemins de
// fichier trouvés par Rust (`find_terminal_links`). Les deux donnent des indices de chaîne
// JavaScript (unités UTF-16) dans le texte d'une ligne, convertis ici en colonnes de cellules.

/** Une cellule d'une ligne d'xterm : ses caractères et sa largeur (2 : caractère large). */
export type Cell = { chars: string; width: number };

/** Texte d'une ligne d'xterm et conversion de ses indices de chaîne en colonnes de cellules. */
export type LineText = {
  text: string;
  /**
   * Colonnes de cellules (1-indexées, fin incluse, comme `ILink.range` d'xterm) couvrant les
   * indices `[start, end)` du texte ; `null` si l'intervalle est vide ou hors du texte.
   */
  columns: (start: number, end: number) => { start: number; end: number } | null;
};

/**
 * Texte d'une ligne et correspondance indice → cellule. La cellule qui suit un caractère large
 * (largeur 0) est sautée ; une cellule vide compte pour une espace.
 *
 * Limite : une ligne repliée (suite d'une ligne trop longue) est lue seule, donc un chemin
 * coupé par le bord du terminal n'est pas un lien.
 */
export function lineText(cells: readonly Cell[]): LineText {
  let text = "";
  /** Pour chaque unité UTF-16 du texte : première et dernière colonne de sa cellule. */
  const first: number[] = [];
  const last: number[] = [];
  cells.forEach((cell, index) => {
    if (cell.width === 0) return;
    const chars = cell.chars === "" ? " " : cell.chars;
    const column = index + 1;
    for (let i = 0; i < chars.length; i += 1) {
      first.push(column);
      last.push(column + cell.width - 1);
    }
    text += chars;
  });
  return {
    text,
    columns: (start, end) => {
      if (start < 0 || end <= start || end > text.length) return null;
      return { start: first[start]!, end: last[end - 1]! };
    },
  };
}

/** URL trouvée dans une ligne, indices UTF-16 (fin exclue). */
export type UrlMatch = { start: number; end: number; url: string };

/** `http://` ou `https://` suivi de caractères qui ne sont ni blancs ni délimiteurs. */
const URL_PATTERN = /https?:\/\/[^\s"'`<>()[\]{}]+/g;
/** Ponctuation de fin de phrase, laissée hors de l'URL. */
const TRAILING = /[.,;:!?]+$/;

/** URL `http(s)` de `text`, dans l'ordre, sans la ponctuation qui les suit. */
export function findUrls(text: string): UrlMatch[] {
  const found: UrlMatch[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, "");
    // `https://` seul n'est pas un lien.
    if (/^https?:\/\/$/.test(url)) continue;
    found.push({ start: match.index, end: match.index + url.length, url });
  }
  return found;
}
