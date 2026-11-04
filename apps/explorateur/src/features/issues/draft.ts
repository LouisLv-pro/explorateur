// Brouillon de la nouvelle issue (docs/specs/issues-github.md, lot 2) : titre, corps, labels et
// assignés gardés par dépôt dans le `localStorage` jusqu'à la création. Fonctions pures.
import type { NewIssue } from "@/bindings";

export type IssueDraft = NewIssue;

export const EMPTY_DRAFT: IssueDraft = { title: "", body: "", labels: [], assignees: [] };

/** Clé du brouillon d'un dépôt (`owner/repo`). */
export const issueDraftKey = (repo: string) => `explorateur.issue-draft:${repo}`;

export function isEmptyDraft(draft: IssueDraft): boolean {
  return (
    draft.title === "" &&
    draft.body === "" &&
    draft.labels.length === 0 &&
    draft.assignees.length === 0
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Brouillon gardé pour ce dépôt, `null` s'il n'y en a pas (ou s'il est illisible). */
export function loadIssueDraft(storage: Pick<Storage, "getItem">, repo: string): IssueDraft | null {
  try {
    const raw = storage.getItem(issueDraftKey(repo));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const draft: IssueDraft = {
      title: typeof record.title === "string" ? record.title : "",
      body: typeof record.body === "string" ? record.body : "",
      labels: strings(record.labels),
      assignees: strings(record.assignees),
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

/** Garde le brouillon de ce dépôt ; un brouillon vide l'efface. */
export function saveIssueDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  repo: string,
  draft: IssueDraft,
) {
  try {
    if (isEmptyDraft(draft)) storage.removeItem(issueDraftKey(repo));
    else storage.setItem(issueDraftKey(repo), JSON.stringify(draft));
  } catch {
    // Non enregistré : le brouillon vaut pour la session.
  }
}

/**
 * Brouillon avec `text` ajouté à la fin du corps (ligne vide avant), sans toucher au reste. Sans
 * brouillon, un brouillon neuf dont le corps est `text`. Issue créée depuis le code (lot 3).
 */
export function appendToDraft(draft: IssueDraft | null, text: string): IssueDraft {
  const base = draft ?? EMPTY_DRAFT;
  const body = base.body.replace(/\s+$/, "");
  return { ...base, body: body === "" ? text : `${body}\n\n${text}` };
}

/** Ajoute `text` au corps du brouillon gardé de ce dépôt (créé s'il n'existe pas). */
export function appendToIssueDraft(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  repo: string,
  text: string,
) {
  saveIssueDraft(storage, repo, appendToDraft(loadIssueDraft(storage, repo), text));
}

/** Efface le brouillon de ce dépôt (après la création, ou « Effacer le brouillon »). */
export function clearIssueDraft(storage: Pick<Storage, "removeItem">, repo: string) {
  try {
    storage.removeItem(issueDraftKey(repo));
  } catch {
    // Rien à effacer.
  }
}
