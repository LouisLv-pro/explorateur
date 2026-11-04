// Textes des confirmations du terminal (docs/specs/terminal.md, lot 2), purs pour être testés.
// Composés à l'appel dans la langue active.
import i18n, { currentLanguage } from "@/i18n";

export type ConfirmText = { title: string; description: string; confirmLabel: string };

/** « a », « a et b », « a, b et c » (« a, b, and c » en anglais). */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return new Intl.ListFormat(currentLanguage(), { style: "long", type: "conjunction" }).format(
    items,
  );
}

/** Fermer une page dont `command` tourne au premier plan. */
export function stopPageConfirmation(command: string): ConfirmText {
  return {
    title: i18n.t("terminal:confirm.stopPage.title", { command }),
    description: i18n.t("terminal:confirm.stopPage.description"),
    confirmLabel: i18n.t("terminal:confirm.stopPage.confirm"),
  };
}

/**
 * Quitter l'app avec `unsaved` fichiers modifiés et les commandes `running` en cours dans le
 * terminal : une seule boîte qui mentionne les deux. `null` : rien à confirmer.
 */
export function quitConfirmation(unsaved: number, running: readonly string[]): ConfirmText | null {
  if (unsaved === 0 && running.length === 0) return null;
  if (running.length === 0) {
    return {
      title: i18n.t("terminal:confirm.unsaved", { count: unsaved }),
      description: i18n.t("terminal:confirm.quitUnsaved.description"),
      confirmLabel: i18n.t("terminal:confirm.quitUnsaved.confirm"),
    };
  }
  if (unsaved === 0) {
    return {
      title: i18n.t("terminal:confirm.quitRunning.title", {
        count: running.length,
        command: running[0],
      }),
      description: i18n.t("terminal:confirm.quitRunning.description", { list: listOf(running) }),
      confirmLabel: i18n.t("terminal:confirm.quitRunning.confirm"),
    };
  }
  return {
    title: i18n.t("terminal:confirm.quitBoth.title"),
    description: i18n.t("terminal:confirm.quitBoth.description", {
      files: i18n.t("terminal:confirm.unsavedLost", { count: unsaved }),
      list: listOf(running),
    }),
    confirmLabel: i18n.t("terminal:confirm.quitBoth.confirm"),
  };
}
