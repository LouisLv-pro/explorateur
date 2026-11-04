/** Une couleur trouvée dans un texte : `text.slice(start, end) === value`. */
export type FoundColor = { start: number; end: number; value: string };

// Ni lettre, ni chiffre, ni `_` de part et d'autre (`a#fff`, `#fffg`, `xrgb(…)` : rien).
const HEX = /(?<!\w)#([0-9a-f]+)(?!\w)/gi;
const FUNCTION = /(?<!\w)(?:rgba?|hsla?|oklch)\(([^()]*)\)(?!\w)/gi;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/;

/** `#rgb(a)` doit contenir une lettre (`#123` est plutôt un numéro de ticket). */
function isHexColor(digits: string): boolean {
  if (digits.length === 6 || digits.length === 8) return true;
  return (digits.length === 3 || digits.length === 4) && /[a-f]/i.test(digits);
}

/** Trois ou quatre nombres, séparés par des virgules, des espaces ou `/` (alpha). */
function isColorArguments(args: string): boolean {
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  return (parts.length === 3 || parts.length === 4) && parts.every((p) => NUMBER.test(p));
}

/**
 * Couleurs CSS écrites dans `text` (spec pastilles-couleur.md) : `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`. Triées par position.
 */
export function findColors(text: string): FoundColor[] {
  const found: FoundColor[] = [];
  for (const match of text.matchAll(HEX)) {
    if (isHexColor(match[1] as string)) {
      found.push({ start: match.index, end: match.index + match[0].length, value: match[0] });
    }
  }
  for (const match of text.matchAll(FUNCTION)) {
    if (isColorArguments(match[1] as string)) {
      found.push({ start: match.index, end: match.index + match[0].length, value: match[0] });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
