/** Format d'un fichier de données montré en tableau (CSV, TSV) ou en arbre (JSON, YAML). */
export type DataFormat = "csv" | "tsv" | "json" | "yaml";

// Une `Map` : `a.constructor` ne doit pas trouver `Object.prototype.constructor`.
const BY_EXTENSION = new Map<string, DataFormat>([
  ["csv", "csv"],
  ["tsv", "tsv"],
  ["json", "json"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

/**
 * Format d'un fichier d'après son nom (extension finale, casse ignorée), ou `undefined`.
 * Le type d'aperçu reste `Text` côté Rust : seul le front distingue ces fichiers.
 */
export function dataFormat(name: string): DataFormat | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
}
