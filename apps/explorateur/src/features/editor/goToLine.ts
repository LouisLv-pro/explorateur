import type { RefObject } from "react";
import { gotoLine } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { useTranslation } from "react-i18next";
import { useCommand } from "@/features/commands";

/**
 * Commande « Aller à la ligne… » de la palette (docs/specs/aller-a-la-ligne.md), présente tant que
 * l'éditeur est monté. Elle ouvre le champ de `@codemirror/search`, qui prend le focus de lui-même
 * (la palette lance la commande une fois son propre focus rendu).
 */
export function useGoToLineCommand(viewRef: RefObject<EditorView | null>): void {
  const { t } = useTranslation(["editor", "shortcuts"]);
  useCommand({
    id: "go-to-line",
    label: t("editor:goToLine.label"),
    group: t("shortcuts:groups.editor"),
    shortcut: "editor-go-to-line",
    run: () => {
      if (viewRef.current) gotoLine(viewRef.current);
    },
  });
}
