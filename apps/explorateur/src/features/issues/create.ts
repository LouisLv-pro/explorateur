// Création d'une issue (docs/specs/issues-github.md, lot 2) : logique pure du dialogue.
import type { IssueTemplate, Label } from "@/bindings";
import i18n from "@/i18n";
import { panelError, unavailableMessage } from "./model";
import type { IssueDraft } from "./draft";

/** Au moins cette largeur de dialogue (px) : le corps s'ouvre en Écrire + Aperçu côte à côte. */
export const SPLIT_MIN_WIDTH = 900;

export type BodyMode = "write" | "split" | "preview";

/** Modes du corps, dans l'ordre du sélecteur. */
export const BODY_MODES: readonly BodyMode[] = ["write", "split", "preview"];

/** Mode du corps tant que l'utilisateur n'en a pas choisi : Scindé si le dialogue est large. */
export function defaultBodyMode(dialogWidth: number): BodyMode {
  return dialogWidth >= SPLIT_MIN_WIDTH ? "split" : "write";
}

/** « Créer l'issue » : un titre non vide, et pas de création en cours. */
export function canCreate(title: string, busy: boolean): boolean {
  return !busy && title.trim() !== "";
}

/** Ce que le modèle remplit : titre, corps, labels et assignés. */
export function draftFromTemplate(template: IssueTemplate): IssueDraft {
  return {
    title: template.title,
    body: template.body,
    labels: [...template.labels],
    assignees: [...template.assignees],
  };
}

/** Ajoute `value` à la liste, ou le retire s'il y est déjà. */
export function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Ajoute `login` aux assignés sans le doubler. */
export function addAssignee(list: readonly string[], login: string): string[] {
  return list.includes(login) ? [...list] : [...list, login];
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Labels dont le nom ou la description contient la recherche (casse et accents ignorés). */
export function filterLabels(labels: readonly Label[], query: string): Label[] {
  const needle = fold(query.trim());
  if (needle === "") return [...labels];
  return labels.filter(
    (label) => fold(label.name).includes(needle) || fold(label.description).includes(needle),
  );
}

/** Logins qui contiennent la recherche (casse et accents ignorés). */
export function filterLogins(logins: readonly string[], query: string): string[] {
  const needle = fold(query.trim());
  if (needle === "") return [...logins];
  return logins.filter((login) => fold(login).includes(needle));
}

/**
 * Labels à lister : ceux du dépôt, plus les sélectionnés qui n'y sont plus (brouillon ancien,
 * modèle d'un autre dépôt), sinon on ne pourrait pas les décocher.
 */
export function labelsWithSelected(labels: readonly Label[], selected: readonly string[]): Label[] {
  const known = new Set(labels.map((l) => l.name));
  const missing = selected
    .filter((name) => !known.has(name))
    .map((name) => ({ name, color: "ededed", description: i18n.t("issues:labels.missing") }));
  return [...missing, ...labels];
}

/** Logins à lister : ceux du dépôt, plus les sélectionnés qui n'y sont pas. */
export function loginsWithSelected(
  logins: readonly string[],
  selected: readonly string[],
): string[] {
  const known = new Set(logins);
  return [...selected.filter((login) => !known.has(login)), ...logins];
}

/**
 * Labels de la liste du dialogue : les cochés d'abord (toujours visibles, même absents du dépôt
 * ou hors recherche), puis les autres qui correspondent à la recherche.
 */
export function searchLabels(
  labels: readonly Label[],
  selected: readonly string[],
  query: string,
): Label[] {
  const all = labelsWithSelected(labels, selected);
  const checked = all.filter((label) => selected.includes(label.name));
  const others = all.filter((label) => !selected.includes(label.name));
  return [...checked, ...filterLabels(others, query)];
}

/** Logins de la liste du dialogue : les cochés d'abord, puis les autres qui correspondent. */
export function searchLogins(
  logins: readonly string[],
  selected: readonly string[],
  query: string,
): string[] {
  const all = loginsWithSelected(logins, selected);
  const checked = all.filter((login) => selected.includes(login));
  const others = all.filter((login) => !selected.includes(login));
  return [...checked, ...filterLogins(others, query)];
}

/** Texte du bloc d'erreur : sortie de `gh`, ou la raison connue (hors ligne, non connecté…). */
export function createErrorText(error: unknown): string {
  const failure = panelError(error);
  return "reason" in failure ? unavailableMessage(failure.reason) : failure.output;
}
