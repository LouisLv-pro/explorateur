// Filtrage des commandes de la palette (docs/specs/palette-commandes.md), pur et sans React.

/** Classement d'une correspondance : plus petit = meilleur. */
export type MatchRank = 0 | 1 | 2 | 3;

export type CommandMatch = {
  /** 0 : le libellé commence par la requête ; 1 : d'un bloc au début d'un mot ; 2 : d'un bloc ailleurs ; 3 : lettres éparses. */
  rank: MatchRank;
  /** Indices (en caractères) des lettres du libellé à mettre en gras. */
  matched: number[];
};

/** Une lettre sans casse ni accent : « É » donne « e ». */
function fold(char: string): string {
  const folded = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return folded === "" ? char : folded;
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

/**
 * Cherche les lettres de `query` (espaces ignorés) dans `label`, dans l'ordre, sans tenir compte
 * de la casse ni des accents. Un bloc compte même s'il traverse une espace du libellé. `null` :
 * pas de correspondance. Requête vide : rang 0, rien en gras.
 */
export function matchCommand(query: string, label: string): CommandMatch | null {
  const wanted = [...query].filter((char) => char.trim() !== "").map(fold);
  if (wanted.length === 0) return { rank: 0, matched: [] };

  const chars = [...label];
  // Les lettres du libellé sans ses espaces, avec leur indice dans le libellé.
  const slots: { index: number; folded: string }[] = [];
  chars.forEach((char, index) => {
    if (char.trim() !== "") slots.push({ index, folded: fold(char) });
  });

  let inside: number[] | null = null;
  for (let start = 0; start + wanted.length <= slots.length; start++) {
    if (!wanted.every((letter, offset) => slots[start + offset]?.folded === letter)) continue;
    const matched = wanted.map((_, offset) => slots[start + offset]?.index ?? 0);
    if (start === 0) return { rank: 0, matched };
    const first = matched[0] ?? 0;
    if (!isWordChar(chars[first - 1] ?? "")) return { rank: 1, matched };
    inside ??= matched;
  }
  if (inside !== null) return { rank: 2, matched: inside };

  // Lettres éparses : la première occurrence de chacune, dans l'ordre.
  const scattered: number[] = [];
  let from = 0;
  for (const letter of wanted) {
    const slot = slots.slice(from).findIndex((candidate) => candidate.folded === letter);
    if (slot < 0) return null;
    scattered.push(slots[from + slot]?.index ?? 0);
    from += slot + 1;
  }
  return { rank: 3, matched: scattered };
}

/**
 * Les éléments de `items` dont le libellé correspond à `query`, meilleur classement d'abord.
 * À classement égal, l'ordre de `items` (celui du registre) est gardé.
 */
export function filterCommands<T extends { label: string }>(
  items: readonly T[],
  query: string,
): { command: T; matched: number[] }[] {
  const hits: { command: T; matched: number[]; rank: MatchRank }[] = [];
  for (const command of items) {
    const match = matchCommand(query, command.label);
    if (match) hits.push({ command, matched: match.matched, rank: match.rank });
  }
  // `sort` est stable : l'ordre du registre départage les égalités.
  hits.sort((a, b) => a.rank - b.rank);
  return hits.map(({ command, matched }) => ({ command, matched }));
}
