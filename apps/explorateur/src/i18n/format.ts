// Dates et nombres dans la langue active (docs/specs/langue-interface.md) : `Intl`, jamais de
// `"fr-FR"` en dur. Lus à l'appel, donc à jour après un changement de langue.
import { currentLanguage } from "@/i18n";

/** Espace insécable et espace fine insécable, que met Intl entre le nombre et l'unité. */
const NO_BREAK_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, "g");

/** « il y a 3 h » avec une espace simple, comme les textes écrits avant la traduction. */
function plainSpaces(text: string): string {
  return text.replace(NO_BREAK_SPACES, " ");
}

type Unit = "minute" | "hour" | "day" | "month" | "year";

/**
 * « il y a 3 h » / « 3 hr. ago » : `value` unités dans le passé. Minutes, heures et jours en
 * style court, mois et années en style long (« il y a 1 mois », « il y a 2 ans »).
 */
export function relativeTime(value: number, unit: Unit): string {
  const style = unit === "month" || unit === "year" ? "long" : "short";
  return plainSpaces(
    new Intl.RelativeTimeFormat(currentLanguage(), { numeric: "always", style }).format(
      -value,
      unit,
    ),
  );
}

/** Date et heure exactes : « 9 octobre 2026 à 10:00 » / « October 9, 2026 at 10:00 AM ». */
export function formatDateTime(date: Date): string {
  return plainSpaces(
    date.toLocaleString(currentLanguage(), { dateStyle: "long", timeStyle: "short" }),
  );
}

/** Nombre avec les séparateurs de la langue : « 2 000 » / « 2,000 ». */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLanguage(), options).format(value);
}
