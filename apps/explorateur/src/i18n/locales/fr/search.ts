import type { search as en } from "../en/search";

export const search: typeof en = {
  placeholder: "Rechercher dans les fichiers…",
  label: "Rechercher dans les fichiers",
  caseSensitive: "Respecter la casse",
  caseToggle: "Aa",
  results: "Résultats",
  tooShort: "Tapez au moins 2 caractères.",
  failed: "Recherche impossible.",
  none: "Aucun résultat.",
  summary: "{{results}} dans {{files}}",
  summaryTruncated: "{{results}} dans {{files}} (limité à {{limit}})",
  result_one: "{{n}} résultat",
  result_other: "{{n}} résultats",
  file_one: "{{n}} fichier",
  file_other: "{{n}} fichiers",
};
