import i18n from "@/i18n";
import { formatNumber } from "@/i18n/format";

/** « 1 diapositive » / « 11 diapositives » (ou « 1 slide » / « 11 slides »), dans la langue active. */
export function slidesLabel(count: number): string {
  return i18n.t("preview:presentation.slides", { count, n: formatNumber(count) });
}
