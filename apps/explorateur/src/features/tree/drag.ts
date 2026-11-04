// Glisser une entrée de l'arborescence (spec terminal.md, lot 2 : la déposer sur le terminal
// insère son chemin). Type propre à l'app : un dépôt ailleurs (éditeur, autre app) l'ignore.
import type { DragEvent } from "react";

/** Type `dataTransfer` portant le chemin absolu de l'entrée glissée. */
export const ENTRY_PATH_MIME = "application/x-explorateur-path";

/** Début du glisser d'une entrée : pose son chemin absolu. */
export function startEntryDrag(event: DragEvent, path: string) {
  event.dataTransfer.setData(ENTRY_PATH_MIME, path);
  event.dataTransfer.effectAllowed = "copy";
}

/** Vrai si le glisser en cours porte une entrée de l'arborescence. */
export function carriesEntry(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(ENTRY_PATH_MIME);
}
