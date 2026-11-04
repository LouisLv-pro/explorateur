// Analyse des fichiers de données (docs/specs/apercu-donnees.md) : fonctions pures, sans React.
// Ce module vit dans le chunk chargé à la demande (`DataView`) : papaparse y est importé en
// statique, `yaml` seulement à la première analyse d'un `.yaml`.
import Papa from "papaparse";
import i18n from "@/i18n";
import type { DataFormat } from "./formats";

/** Erreur d'analyse : message du moteur, ligne et colonne (à partir de 1) quand il les donne. */
export type ParseError = { message: string; line?: number; column?: number };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

/** Tableau CSV ou TSV : `rows[0]` est l'en-tête. */
export type CsvTable = { rows: string[][]; delimiter: string };

/**
 * Message de `ParseError` d'un guillemet non fermé : sert d'identifiant (parse.test.ts le fixe),
 * `invalidMessage` le remplace par le texte de la langue active.
 */
export const UNTERMINATED_QUOTE = "guillemet non fermé";

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (message: string, line?: number, column?: number): Parsed<never> => ({
  ok: false,
  error: { message, line, column },
});

/** Numéro de ligne (à partir de 1) du caractère `index` du texte. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

/**
 * Analyse un CSV (délimiteur deviné parmi `,` `;` tabulation `|`, repli virgule) ou un TSV
 * (tabulation). Seul un guillemet non fermé est une erreur : les autres écarts de papaparse
 * (guillemets mal placés, lignes de longueurs différentes) s'affichent tels quels.
 */
export function parseCsv(text: string, format: "csv" | "tsv"): Parsed<CsvTable> {
  const result = Papa.parse<string[]>(text, {
    delimiter: format === "tsv" ? "\t" : "",
    delimitersToGuess: [",", ";", "\t", "|"],
    skipEmptyLines: "greedy",
  });
  const unterminated = result.errors.find((e) => e.code === "MissingQuotes");
  if (unterminated) {
    const line = unterminated.index === undefined ? undefined : lineAt(text, unterminated.index);
    return fail(UNTERMINATED_QUOTE, line);
  }
  return ok({ rows: result.data, delimiter: result.meta.delimiter });
}

/** Analyse un JSON strict (`JSON.parse`) : message natif, position si le moteur la donne. */
export function parseJson(text: string): Parsed<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /line (\d+) column (\d+)/.exec(message);
    return fail(
      message,
      position ? Number(position[1]) : undefined,
      position ? Number(position[2]) : undefined,
    );
  }
}

/** Première ligne d'un message, sans la position que `prettyErrors` y ajoute (` at line 3, column 1:`). */
function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).replace(/ at line \d+, column \d+:?$/, "");
}

/** Définit la propriété même pour `__proto__`, que l'affectation prendrait pour le prototype. */
function setKey(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Convertit les `Map` de `yaml` en objets : une clé non textuelle devient sa représentation JSON. */
function plain(value: unknown): unknown {
  if (value instanceof Map) {
    const object: Record<string, unknown> = {};
    for (const [key, item] of value as Map<unknown, unknown>) {
      setKey(object, typeof key === "string" ? key : JSON.stringify(plain(key)), plain(item));
    }
    return object;
  }
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

/**
 * Analyse un YAML (schéma coeur 1.2, clés de fusion `<<` résolues). Plusieurs documents (`---`)
 * donnent un tableau racine. Le module `yaml` est chargé à la première analyse.
 */
export async function parseYaml(text: string): Promise<Parsed<unknown>> {
  try {
    const { parseAllDocuments } = await import("yaml");
    const documents = parseAllDocuments(text, { merge: true, prettyErrors: true });
    for (const document of documents) {
      const error = document.errors[0];
      if (error) {
        return fail(firstLine(error.message), error.linePos?.[0].line, error.linePos?.[0].col);
      }
    }
    // `mapAsMap` garde les clés non textuelles intactes jusqu'à `plain`.
    const values = documents.map((document) => plain(document.toJS({ mapAsMap: true })));
    if (values.length === 0) return ok(null);
    return ok(values.length === 1 ? values[0] : values);
  } catch (error) {
    // Typiquement la limite d'alias de `toJS` (bombe d'expansion).
    return fail(firstLine(error instanceof Error ? error.message : String(error)));
  }
}

/** Bannière d'un fichier invalide : `YAML invalide : <message> (ligne 3, colonne 5)`. */
export function invalidMessage(format: DataFormat, error: ParseError): string {
  const { line, column } = error;
  const place =
    // Le message natif de JSON donne déjà sa position, quand le moteur en a une.
    format === "json" || line === undefined
      ? ""
      : column === undefined
        ? i18n.t("preview:data.atLine", { line })
        : i18n.t("preview:data.atLineColumn", { line, column });
  const message =
    error.message === UNTERMINATED_QUOTE ? i18n.t("preview:data.unterminatedQuote") : error.message;
  return i18n.t("preview:data.invalid", { type: format.toUpperCase(), message, place });
}
