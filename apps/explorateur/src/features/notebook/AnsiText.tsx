// Pile d'erreur colorée par séquences ANSI (IPython) : chaque morceau devient un `span` React,
// le texte reste échappé par React (jamais de HTML injecté).
import { useMemo, type CSSProperties } from "react";
import {
  parseAnsiSequences,
  type Color,
  type ColorName,
  type ParseToken,
} from "ansi-sequence-parser";

/** Couleurs nommées → rôles `syntax-*` de DESIGN.md (suivent le mode sombre). Noir et blanc : couleur du texte. */
const ROLES: Partial<Record<ColorName, string>> = {
  red: "tag",
  brightRed: "tag",
  green: "string",
  brightGreen: "string",
  yellow: "number",
  brightYellow: "property",
  blue: "function",
  brightBlue: "function",
  magenta: "macro",
  brightMagenta: "macro",
  cyan: "type",
  brightCyan: "type",
  brightBlack: "comment",
};

const TABLE_NAMES: ColorName[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

/** Rôle d'une couleur ANSI ; les couleurs 256 au-delà des 16 premières et le RGB sont ignorés. */
function role(color: Color | null): string | undefined {
  if (!color) return undefined;
  if (color.type === "named") return ROLES[color.name];
  if (color.type === "table") {
    const name = TABLE_NAMES[color.index];
    return name ? ROLES[name] : undefined;
  }
  return undefined;
}

function styleOf(token: ParseToken): CSSProperties | undefined {
  const name = role(token.foreground);
  const style: CSSProperties = {};
  if (name) style.color = `var(--color-syntax-${name})`;
  if (token.decorations.has("bold")) style.fontWeight = 600;
  if (token.decorations.has("italic")) style.fontStyle = "italic";
  if (token.decorations.has("underline")) style.textDecoration = "underline";
  if (token.decorations.has("dim")) style.opacity = 0.7;
  return Object.keys(style).length > 0 ? style : undefined;
}

export function AnsiText({ text }: { text: string }) {
  const tokens = useMemo(() => parseAnsiSequences(text), [text]);
  return tokens.map((token, index) => {
    const style = styleOf(token);
    return style ? (
      // Les morceaux ne bougent jamais entre eux : l'index suffit comme clé.
      <span key={index} style={style}>
        {token.value}
      </span>
    ) : (
      token.value
    );
  });
}
