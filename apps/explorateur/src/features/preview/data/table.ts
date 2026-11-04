// Mise en page du tableau CSV / TSV (docs/specs/apercu-donnees.md) : fonctions pures.
import i18n from "@/i18n";

const MIN_WIDTH = 6;
const MAX_WIDTH = 40;
/** Part des cellules non vides de l'échantillon qui doivent être des nombres. */
const NUMERIC_SHARE = 0.9;

export type TableLayout = {
  columns: number;
  /** Largeur de chaque colonne en `ch`, entre 6 et 40. */
  widths: number[];
  /** Colonne de nombres : alignée à droite. */
  numeric: boolean[];
};

/** Texte d'une cellule sur une seule ligne : chaque retour à la ligne devient une espace. */
export function cellText(cell: string): string {
  return cell.replace(/\r\n|\r|\n/g, " ");
}

const NUMBER = /^[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i;

/**
 * Largeurs et alignements des colonnes, calculés sur toutes les lignes (un seul passage, le
 * fichier fait 2 Mio au plus) : une cellule longue en fin de fichier ne ressort pas tronquée.
 * Le nombre de colonnes est le maximum de toutes les lignes.
 */
export function layoutTable(rows: string[][]): TableLayout {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths: number[] = Array(columns).fill(MIN_WIDTH);
  const numbers: number[] = Array(columns).fill(0);
  const filled: number[] = Array(columns).fill(0);

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      widths[c] = Math.min(MAX_WIDTH, Math.max(widths[c] ?? MIN_WIDTH, cellText(cell).length));
      // L'en-tête est un libellé : il ne compte pas dans le caractère numérique de la colonne.
      const value = cell.trim();
      if (r === 0 || value === "") return;
      filled[c] = (filled[c] ?? 0) + 1;
      if (NUMBER.test(value)) numbers[c] = (numbers[c] ?? 0) + 1;
    });
  });

  return {
    columns,
    widths,
    numeric: numbers.map((n, c) => {
      const total = filled[c] ?? 0;
      return total > 0 && n / total >= NUMERIC_SHARE;
    }),
  };
}

/** Délimiteur dit en toutes lettres, dans la langue active, pour le pied du tableau. */
export function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case ",":
      return i18n.t("preview:table.delimiters.comma");
    case ";":
      return i18n.t("preview:table.delimiters.semicolon");
    case "\t":
      return i18n.t("preview:table.delimiters.tab");
    case "|":
      return i18n.t("preview:table.delimiters.pipe");
    default:
      return delimiter;
  }
}
