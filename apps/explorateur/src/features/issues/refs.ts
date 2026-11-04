// Références d'issue dans un texte (docs/specs/issues-github.md, lot 3) : `#123` et liens
// `https://github.com/<owner>/<repo>/issues/123` du même dépôt. Fonctions pures.
import { panelError } from "./model";

/** Une référence `#123` trouvée dans un texte : `text.slice(start, end) === "#123"`. */
export type IssueRef = { start: number; end: number; number: number };

/**
 * `#` suivi d'un numéro sans zéro en tête. Ni mot, ni `/` (autre dépôt, adresse), ni `&` (entité
 * HTML), ni `#` (titre) avant ; pas de mot collé après (`#12abc`).
 */
const REF = /(?<![\p{L}\p{N}_/&#])#([1-9]\d{0,8})(?![\p{L}\p{N}_])/gu;
/** Une adresse web jusqu'au prochain blanc ou délimiteur : une référence dedans est une ancre. */
const URL_RANGE = /https?:\/\/[^\s"'`<>()[\]{}]+/g;

/** Références `#123` de `text`, dans l'ordre, hors des adresses web. */
export function findIssueRefs(text: string): IssueRef[] {
  if (!text.includes("#")) return [];
  const urls = [...text.matchAll(URL_RANGE)].map((m) => [m.index, m.index + m[0].length] as const);
  const found: IssueRef[] = [];
  for (const match of text.matchAll(REF)) {
    const start = match.index;
    if (urls.some(([from, to]) => start >= from && start < to)) continue;
    found.push({ start, end: start + match[0].length, number: Number(match[1]) });
  }
  return found;
}

/** Le texte contient au moins une référence `#123`. */
export function hasIssueRef(text: string): boolean {
  return findIssueRefs(text).length > 0;
}

const ISSUE_URL = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i;

/** Dépôt (`owner/repo`) et numéro d'un lien `https://github.com/<owner>/<repo>/issues/N`. */
export function parseIssueUrl(href: string | undefined): { repo: string; number: number } | null {
  const match = href === undefined ? null : ISSUE_URL.exec(href);
  if (!match) return null;
  return { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

/**
 * Numéro de l'issue d'un lien `https://github.com/<owner>/<repo>/issues/N` quand il désigne le
 * dépôt `repoName` (`owner/repo`, casse ignorée) ; `null` sinon (autre dépôt, pull request,
 * liste, sous-page, autre site, dépôt inconnu).
 */
export function sameRepoIssueNumber(
  href: string | undefined,
  repoName: string | null,
): number | null {
  const parsed = parseIssueUrl(href);
  if (parsed === null || repoName === null) return null;
  return parsed.repo.toLowerCase() === repoName.toLowerCase() ? parsed.number : null;
}

/** Adresse de la pull request `number` du dépôt d'adresse `repoUrl`. */
export function pullRequestUrl(repoUrl: string, number: number): string {
  return `${repoUrl.replace(/\/+$/, "")}/pull/${number}`;
}

/** `gh issue view` sur le numéro d'une pull request réussit : l'`url` rendue est en `/pull/N`. */
export function isPullRequestUrl(url: string): boolean {
  return /\/pull\/\d+(?:[/?#]|$)/.test(url);
}

/** Repli : un `gh` plus ancien peut échouer, `gh issue view` sur d'une pull request échoue avec « is a pull request ». */
export function isPullRequestError(error: unknown): boolean {
  const failure = panelError(error);
  return "output" in failure && /is a pull request/i.test(failure.output);
}
