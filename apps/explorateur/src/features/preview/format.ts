import i18n from "@/i18n";
import { formatNumber } from "@/i18n/format";

const UNITS = ["b", "kb", "mb", "gb"] as const;

/** Taille lisible dans la langue active, base 1024 : `842 o`, `12,4 Ko`, `3,1 Mo` / `12.4 KB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${formatNumber(bytes, { useGrouping: false })} ${i18n.t("preview:size.b")}`;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 1023,96 Ko s'arrondirait à « 1024,0 Ko » : on passe à l'unité suivante.
  if (Number(value.toFixed(1)) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return `${formatNumber(value, decimals)} ${i18n.t(`preview:size.${UNITS[unit] ?? "b"}`)}`;
}
