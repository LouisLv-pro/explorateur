import type { ReactNode } from "react";
import { findColors } from "./findColors";
import { SWATCH_CLASS } from "./swatch";

/** Pastille décorative d'une couleur CSS, posée devant sa valeur. */
export function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className={SWATCH_CLASS}
      data-color-swatch=""
      aria-hidden="true"
      style={{ backgroundColor: color }}
    />
  );
}

/** `text` avec une pastille devant chaque couleur trouvée (texte rendu intact). */
export function withSwatches(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const { start, value } of findColors(text)) {
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(<ColorSwatch key={start} color={value} />);
    last = start;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
