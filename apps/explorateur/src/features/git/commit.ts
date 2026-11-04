// Fonctions pures du commit (docs/specs/git.md, lot 2) : bouton, brouillon, « Modifier le
// dernier commit ».
import i18n from "@/i18n";
import { appErrorMessage } from "@/i18n/errors";
import { isAppError } from "@/lib/ipc";

/** Bouton de commit : libellé, indexation préalable de tout, activation. */
export type CommitButton = {
  label: string;
  all: boolean;
  disabled: boolean;
};

/**
 * Rien d'indexé : « Tout committer » (indexe d'abord toutes les modifications). Message vide :
 * désactivé, sauf pour modifier le dernier commit (l'ancien message est gardé). Modifier le
 * dernier commit n'indexe jamais tout : il peut ne changer que le message.
 */
export function commitButton({
  message,
  amend,
  stagedCount,
  busy,
}: {
  message: string;
  amend: boolean;
  stagedCount: number;
  busy: boolean;
}): CommitButton {
  const all = stagedCount === 0 && !amend;
  return {
    label: all ? i18n.t("git:commit.all") : i18n.t("git:commit.button"),
    all,
    disabled: busy || (!amend && message.trim() === ""),
  };
}

const DRAFT_PREFIX = "explorateur.git-draft:";

/** Clé du brouillon d'un dépôt (dossier racine). */
export const draftKey = (root: string) => DRAFT_PREFIX + root;

/** Brouillon de message gardé pour ce dépôt (vide s'il n'y en a pas). */
export function loadDraft(storage: Storage, root: string): string {
  return storage.getItem(draftKey(root)) ?? "";
}

/** Garde le brouillon ; un message vide l'efface. */
export function saveDraft(storage: Storage, root: string, message: string) {
  if (message === "") storage.removeItem(draftKey(root));
  else storage.setItem(draftKey(root), message);
}

/**
 * Cocher « Modifier le dernier commit » : un champ vide reçoit le message du dernier commit.
 * Rend le texte du champ et le message posé (`null` si le champ n'a pas changé).
 */
export function checkAmend(
  message: string,
  last: string | null,
): { message: string; prefilled: string | null } {
  if (message.trim() !== "" || last === null) return { message, prefilled: null };
  return { message: last, prefilled: last };
}

/** Décocher : le champ se vide s'il porte encore le message posé en cochant. */
export function uncheckAmend(message: string, prefilled: string | null): string {
  return prefilled !== null && message === prefilled ? "" : message;
}

const FIXES_LINE = /^\s*fixes\s+#(\d+)\s*$/i;

/**
 * « Lier au commit » (spec issues-github.md, lot 3) : ajoute `Fixes #N` en fin du brouillon.
 * Ligne vide avant, sauf dans un brouillon vide ou à la suite d'autres lignes `Fixes` du dernier
 * paragraphe (les lignes de fin d'un message restent groupées). Une ligne `Fixes #N` déjà
 * présente (casse ignorée) laisse le brouillon tel quel.
 */
export function appendFixes(message: string, issue: number): string {
  const line = `Fixes #${issue}`;
  const lines = message.replace(/\s+$/, "").split("\n");
  if (lines.every((l) => l.trim() === "")) return line;
  if (lines.some((l) => FIXES_LINE.exec(l)?.[1] === String(issue))) return message;
  // Dernier paragraphe : les lignes après la dernière ligne vide.
  let blank = lines.length - 1;
  while (blank >= 0 && lines[blank]?.trim() !== "") blank -= 1;
  const lastParagraph = lines.slice(blank + 1);
  const grouped = blank >= 0 && lastParagraph.every((l) => FIXES_LINE.test(l));
  return `${lines.join("\n")}${grouped ? "\n" : "\n\n"}${line}`;
}

/** Texte d'une erreur de commande git (sortie de git pour `AppError::Git`). */
export function gitErrorText(error: unknown): string {
  return isAppError(error) ? appErrorMessage(error) : String(error);
}
