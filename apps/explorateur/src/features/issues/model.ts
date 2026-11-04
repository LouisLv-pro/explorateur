// Issues GitHub (docs/specs/issues-github.md, lot 1) : logique pure de la vue et de l'onglet.
import type { GithubUnavailable, IssueFilter, IssueSummary } from "@/bindings";
import i18n from "@/i18n";
import { formatDateTime, relativeTime } from "@/i18n/format";
import { appErrorText, isAppError } from "@/lib/ipc";

/** Clé du `localStorage` du filtre d'un dépôt. */
export const issuesFilterKey = (repo: string) => `explorateur.issues-filter:${repo}`;

/** Filtres, dans l'ordre de la vue ; le libellé est `issues:filters.<valeur>`. */
export const FILTERS: readonly IssueFilter[] = ["open", "closed", "mine"];

function isFilter(value: string | null): value is IssueFilter {
  return value === "open" || value === "closed" || value === "mine";
}

/** Filtre gardé pour ce dépôt ; absent, invalide ou stockage inaccessible : « Ouvertes ». */
export function loadFilter(storage: Pick<Storage, "getItem">, repo: string): IssueFilter {
  try {
    const raw = storage.getItem(issuesFilterKey(repo));
    return isFilter(raw) ? raw : "open";
  } catch {
    return "open";
  }
}

export function saveFilter(storage: Pick<Storage, "setItem">, repo: string, filter: IssueFilter) {
  try {
    storage.setItem(issuesFilterKey(repo), filter);
  } catch {
    // Non enregistré : vaut pour la session.
  }
}

/** Minuscules sans accents, pour comparer des mots. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Filtre la liste chargée, sans requête. `#12` : issues dont le numéro commence par 12. `12` :
 * celles-là ou dont le titre contient « 12 ». Sinon, tous les mots doivent se trouver dans le
 * titre (sans tenir compte de la casse ni des accents). Requête vide : toute la liste.
 */
export function filterIssues(issues: readonly IssueSummary[], query: string): IssueSummary[] {
  const text = query.trim();
  if (text === "") return [...issues];
  const hash = /^#(\d+)$/.exec(text);
  if (hash) return issues.filter((i) => String(i.number).startsWith(hash[1] ?? ""));
  const words = fold(text).split(/\s+/);
  const byNumber = /^\d+$/.test(text);
  return issues.filter(
    (i) =>
      (byNumber && String(i.number).startsWith(text)) ||
      words.every((word) => fold(i.title).includes(word)),
  );
}

const BLACK = "#000000";
const WHITE = "#ffffff";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Rouge, vert, bleu (0 à 255) d'une couleur `rrggbb` ou `rgb`, avec ou sans `#` ; sinon `null`. */
function parseHex(color: string): [number, number, number] | null {
  let hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminance relative WCAG d'une couleur de label. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Texte d'un label : noir ou blanc, celui qui a le meilleur contraste avec la couleur de fond
 * GitHub. Couleur illisible : noir.
 */
export function labelTextColor(color: string): string {
  const rgb = parseHex(color);
  if (rgb === null) return BLACK;
  const l = luminance(rgb);
  // Contraste avec le blanc : 1,05 / (l + 0,05) ; avec le noir : (l + 0,05) / 0,05.
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.05 ? WHITE : BLACK;
}

/** Fond de la pastille d'un label : sa couleur GitHub, gris clair si elle est illisible. */
export function labelBackground(color: string): string {
  return parseHex(color) === null ? "#ededed" : `#${color.trim().replace(/^#/, "")}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** « il y a 3 h » : durée écoulée entre `iso` et `now` (ms), au plus grand palier entier. */
export function relativeDate(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const elapsed = now - time;
  if (elapsed < MINUTE) return i18n.t("issues:date.justNow");
  if (elapsed < HOUR) return relativeTime(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relativeTime(Math.floor(elapsed / HOUR), "hour");
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return relativeTime(days, "day");
  if (days < 365) return relativeTime(Math.floor(days / 30), "month");
  return relativeTime(Math.floor(days / 365), "year");
}

/** Date exacte, pour l'infobulle : « 9 octobre 2026 à 10:00 ». */
export function exactDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return formatDateTime(new Date(time));
}

/** Message de la vue pour un état « GitHub indisponible », dans la langue active. */
export function unavailableMessage(reason: GithubUnavailable): string {
  return i18n.t(`issues:unavailable.${reason}`);
}

/** Message de la liste vide selon le filtre. */
export function emptyMessage(filter: IssueFilter): string {
  if (filter === "closed") return i18n.t("issues:list.emptyClosed");
  if (filter === "mine") return i18n.t("issues:list.emptyMine");
  return i18n.t("issues:list.emptyOpen");
}

/** Adresse ouvrable dans le navigateur : `http(s)` et `mailto` ; ni ancre ni chemin relatif. */
export function isOpenable(href: string | undefined): href is string {
  return href !== undefined && /^(https?:\/\/|mailto:)/i.test(href);
}

/** Ce que la vue montre d'une erreur de lecture : une raison connue ou la sortie de `gh`. */
export type PanelError = { reason: GithubUnavailable } | { output: string };

/** Classe l'erreur d'une requête (`AppError` ou autre) pour les messages de la vue. */
export function panelError(error: unknown): PanelError {
  if (isAppError(error)) {
    if (error.kind === "GithubUnavailable") return { reason: error.message };
    if (error.kind === "Gh") return { output: error.message };
    return { output: appErrorText(error) };
  }
  return { output: error instanceof Error ? error.message : String(error) };
}

/** Titre d'onglet : `#N titre`. */
export function issueTabName(number: number, title: string): string {
  return `#${number} ${title}`;
}

/** `gh issue list` rend au plus cette quantité d'issues. */
export const ISSUE_LIMIT = 100;
