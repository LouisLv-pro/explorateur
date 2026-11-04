import type { ContentSearch } from "@/bindings";
import i18n from "@/i18n";
import { formatNumber } from "@/i18n/format";

/** « 12 résultats dans 4 fichiers », suivi de « (limité à 2 000) » si la recherche est tronquée. */
export function summaryOf(search: ContentSearch): string {
  if (search.total === 0) return i18n.t("search:none");
  const results = i18n.t("search:result", { count: search.total, n: formatNumber(search.total) });
  const files = i18n.t("search:file", {
    count: search.files.length,
    n: formatNumber(search.files.length),
  });
  return search.truncated
    ? i18n.t("search:summaryTruncated", { results, files, limit: formatNumber(2000) })
    : i18n.t("search:summary", { results, files });
}

/** Morceau de ligne, occurrence ou non. */
export type Segment = { text: string; match: boolean };

/**
 * Découpe `text` selon `ranges` (`[début, fin)` en caractères, triées, sans chevauchement).
 * Le retrait initial (espaces, tabulations) est omis : l'occurrence reste visible.
 */
export function segmentsOf(
  text: string,
  ranges: readonly (readonly [number, number])[],
): Segment[] {
  const chars = [...text];
  const indent = chars.findIndex((c) => !/\s/u.test(c));
  const segments: Segment[] = [];
  let at = Math.min(indent < 0 ? chars.length : indent, ranges[0]?.[0] ?? chars.length);
  for (const [start, end] of ranges) {
    if (start > at) segments.push({ text: chars.slice(at, start).join(""), match: false });
    segments.push({ text: chars.slice(start, end).join(""), match: true });
    at = end;
  }
  if (at < chars.length) segments.push({ text: chars.slice(at).join(""), match: false });
  return segments;
}
