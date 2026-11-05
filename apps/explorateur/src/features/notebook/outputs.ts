// Sorties des cellules (docs/specs/notebook.md, « Sorties ») : format affiché, `stream` et `\r`,
// événements du noyau appliqués au modèle.
import type { KernelEvent } from "@/bindings";
import {
  joinText,
  splitLines,
  updateCell,
  type Cell,
  type Json,
  type JsonObject,
  type NotebookModel,
} from "./model";

/** Ordre de préférence d'un `display_data` ou `execute_result` : un seul format affiché. */
export const MIME_ORDER = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "text/html",
  "text/markdown",
  "text/plain",
] as const;

export type Format =
  | { mime: (typeof MIME_ORDER)[number]; text: string }
  /** Aucun format connu (Plotly, widgets) : le type MIME est nommé. */
  | { mime: null; unknown: string };

/** `data` vient du fichier ou du noyau : des valeurs JSON, typées `unknown` par les bindings. */
export function chooseFormat(data: Readonly<Record<string, unknown>>): Format {
  for (const mime of MIME_ORDER) {
    if (mime in data) return { mime, text: joinText(data[mime] as Json) };
  }
  return { mime: null, unknown: Object.keys(data)[0] ?? "?" };
}

/** `\r` efface la ligne en cours : de chaque ligne, seul le dernier morceau non vide reste. */
export function applyCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => lastNonEmpty(line.split("\r")))
    .join("\n");
}

function lastNonEmpty(parts: string[]): string {
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i] !== "") return parts[i]!;
  return "";
}

export type DisplayOutput =
  | { kind: "stream"; name: string; text: string }
  | { kind: "error"; ename: string; evalue: string; traceback: string[] }
  | { kind: "data"; format: Format };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Sorties à afficher : `stream` consécutifs de même nom fusionnés, `\r` appliqué. */
export function displayOutputs(outputs: Json[]): DisplayOutput[] {
  const shown: DisplayOutput[] = [];
  for (const output of outputs) {
    if (!isObject(output)) continue;
    switch (output.output_type) {
      case "stream": {
        const name = typeof output.name === "string" ? output.name : "stdout";
        const text = joinText(output.text);
        const last = shown.at(-1);
        if (last?.kind === "stream" && last.name === name) last.text += text;
        else shown.push({ kind: "stream", name, text });
        break;
      }
      case "error":
        shown.push({
          kind: "error",
          ename: typeof output.ename === "string" ? output.ename : "",
          evalue: typeof output.evalue === "string" ? output.evalue : "",
          traceback: Array.isArray(output.traceback)
            ? output.traceback.filter((line) => typeof line === "string")
            : [],
        });
        break;
      case "display_data":
      case "execute_result":
        if (isObject(output.data)) shown.push({ kind: "data", format: chooseFormat(output.data) });
        break;
    }
  }
  return shown.map((o) => (o.kind === "stream" ? { ...o, text: applyCarriageReturns(o.text) } : o));
}

/** Formats enregistrés en tableau de lignes par nbformat (les images restent une chaîne). */
const isSplitMime = (mime: string) =>
  mime.startsWith("text/") || mime === "application/javascript" || mime === "image/svg+xml";

/** Sortie reçue du noyau (chaînes entières) mise à la forme du fichier (lignes). */
function toDisk(output: JsonObject): JsonObject {
  if (output.output_type === "stream") {
    return { ...output, text: splitLines(joinText(output.text)) };
  }
  if (isObject(output.data)) {
    const data: JsonObject = {};
    for (const [mime, value] of Object.entries(output.data)) {
      data[mime] = typeof value === "string" && isSplitMime(mime) ? splitLines(value) : value;
    }
    return { ...output, data };
  }
  return output;
}

const outputsOf = (cell: Cell): Json[] =>
  Array.isArray(cell.json.outputs) ? cell.json.outputs : [];

/** Ajoute une sortie ; un `stream` qui suit un `stream` de même nom s'y fusionne. */
function append(outputs: Json[], output: JsonObject): Json[] {
  const last = outputs.at(-1);
  if (
    output.output_type === "stream" &&
    isObject(last) &&
    last.output_type === "stream" &&
    last.name === output.name
  ) {
    const text = splitLines(joinText(last.text) + joinText(output.text));
    return [...outputs.slice(0, -1), { ...last, text }];
  }
  return [...outputs, output];
}

const withJson = (cell: Cell, patch: JsonObject, rest: Partial<Cell> = {}): Cell => ({
  ...cell,
  ...rest,
  json: { ...cell.json, ...patch },
});

/**
 * Applique un événement du noyau à sa cellule. Les sorties sont vidées au début de l'exécution
 * (`executionStarted`), pas à l'envoi : une cellule annulée (`Aborted`) garde les siennes.
 * `status` et `died` concernent le noyau, pas une cellule : voir `kernel.ts`.
 */
export function applyKernelEvent(model: NotebookModel, event: KernelEvent): NotebookModel {
  switch (event.type) {
    case "executionStarted":
      return updateCell(model, event.cellId, (cell) =>
        withJson(
          cell,
          { execution_count: event.executionCount, outputs: [] },
          { clearPending: false },
        ),
      );
    case "output": {
      const output = event.output as Json;
      if (!isObject(output)) return model;
      return updateCell(model, event.cellId, (cell) =>
        withJson(
          cell,
          { outputs: append(cell.clearPending ? [] : outputsOf(cell), toDisk(output)) },
          { clearPending: false },
        ),
      );
    }
    case "clearOutput":
      return updateCell(model, event.cellId, (cell) => {
        if (event.wait) return cell.clearPending ? cell : { ...cell, clearPending: true };
        return outputsOf(cell).length === 0 ? cell : withJson(cell, { outputs: [] });
      });
    case "executionFinished":
      return updateCell(model, event.cellId, (cell) =>
        cell.running ? { ...cell, running: false } : cell,
      );
    default:
      return model;
  }
}

/** Vrai si l'événement change le fichier (sorties, compteur) : l'onglet devient modifié. */
export function changesFile(event: KernelEvent): boolean {
  return (
    event.type === "executionStarted" ||
    event.type === "output" ||
    (event.type === "clearOutput" && !event.wait)
  );
}
