// Couleurs du terminal tirées des rôles de DESIGN.md (spec terminal.md) : xterm veut des
// couleurs concrètes, relues dans les variables CSS à chaque changement de thème.
import type { ITheme } from "@xterm/xterm";

/** Police monospace de DESIGN.md, puis des polices à glyphes de prompt (Nerd Font) si installées. */
export const TERMINAL_FONT =
  '"Geist Mono Variable", "Geist Mono", "Symbols Nerd Font Mono", "MesloLGS NF", "MesloLGS Nerd Font Mono", "Hack Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Lit les variables du thème appliqué (`.dark` ou non sur `<html>`). */
export function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim();
  const black = color("--color-mute");
  const red = color("--color-syntax-tag");
  const green = color("--color-syntax-string");
  const yellow = color("--color-syntax-property");
  const blue = color("--color-syntax-function");
  const magenta = color("--color-syntax-macro");
  const cyan = color("--color-syntax-type");
  const white = color("--color-body");
  return {
    background: color("--color-canvas"),
    foreground: color("--color-ink"),
    cursor: color("--color-ink"),
    cursorAccent: color("--color-canvas"),
    selectionBackground: color("--color-selection-bg"),
    selectionForeground: color("--color-selection-fg"),
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    // Variantes vives identiques (spec) : les gris restent lisibles sur les deux fonds.
    brightBlack: black,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: white,
  };
}

/** Taille du code de l'éditeur (`--text-code`), 13 px à défaut. */
export function terminalFontSize(): number {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--text-code"),
  );
  return Number.isFinite(value) && value > 0 ? value : 13;
}
