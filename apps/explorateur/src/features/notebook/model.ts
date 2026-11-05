// Modèle d'un notebook Jupyter (docs/specs/notebook.md) : le JSON lu est gardé tel quel, champs
// inconnus compris, et seules les parties touchées sont réécrites. C'est ce qui rend l'écriture
// identique à l'octet quand rien n'a changé.

export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json };

export type CellType = "code" | "markdown" | "raw";

export type Cell = {
  /** Identifiant de la cellule : son `id` nbformat 4.5, sinon un identifiant de session. */
  key: string;
  /** JSON de la cellule, tel qu'il sera écrit. */
  json: JsonObject;
  /** Envoyée au noyau, pas encore finie (`[*]`). État de session, jamais écrit. */
  running?: boolean;
  /** `clear_output(wait=True)` reçu : la prochaine sortie remplace les anciennes. */
  clearPending?: boolean;
};

export type NotebookModel = {
  /** JSON du notebook sans `cells` (métadonnées, `nbformat`, champs inconnus). */
  json: JsonObject;
  cells: Cell[];
};

/** Pourquoi un texte n'est pas un notebook lisible. */
export type InvalidNotebook =
  /** JSON illisible : message du moteur JavaScript. */
  | { kind: "json"; message: string }
  /** JSON valide mais pas un notebook v4 (`nbformat` absent ou inférieur à 4, pas de `cells`). */
  | { kind: "version" };

export type ParsedNotebook =
  { ok: true; model: NotebookModel } | { ok: false; error: InvalidNotebook };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let sessionIds = 0;

/** Identifiant de session d'une cellule sans `id` (notebook antérieur à 4.5), jamais écrit. */
function sessionKey(): string {
  sessionIds += 1;
  return `session-${sessionIds}`;
}

function toCell(json: JsonObject): Cell {
  return { key: typeof json.id === "string" ? json.id : sessionKey(), json };
}

export function parseNotebook(text: string): ParsedNotebook {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { kind: "json", message: String((error as Error).message) } };
  }
  if (
    !isObject(value) ||
    typeof value.nbformat !== "number" ||
    value.nbformat < 4 ||
    !Array.isArray(value.cells) ||
    !value.cells.every(isObject)
  ) {
    return { ok: false, error: { kind: "version" } };
  }
  const { cells, ...json } = value;
  return { ok: true, model: { json, cells: (cells as JsonObject[]).map(toCell) } };
}

/**
 * JSON écrit comme `json.dumps(nb, sort_keys=True, indent=1, ensure_ascii=False)` de Python.
 * Écrit à la main plutôt que `JSON.stringify` : un objet JavaScript range les clés numériques
 * (`"10"`, `"2"`) avant les autres, quel que soit l'ordre d'insertion.
 */
function write(value: Json, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent} `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => inner + write(item, inner));
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  // Tri par unités UTF-16, comme Python pour tout caractère hors des plans supplémentaires.
  const keys = Object.keys(value).sort();
  if (keys.length === 0) return "{}";
  const items = keys.map((key) => `${inner}${JSON.stringify(key)}: ${write(value[key]!, inner)}`);
  return `{\n${items.join(",\n")}\n${indent}}`;
}

/** Texte du fichier : clés triées, indentation d'un espace, retour à la ligne final. */
export function serializeNotebook(model: NotebookModel): string {
  return `${write({ ...model.json, cells: model.cells.map((c) => c.json) }, "")}\n`;
}

/** Lignes d'un texte, fins de ligne gardées (`str.splitlines(True)` de nbformat, pour `\n`). */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Texte d'un champ multiligne de nbformat : chaîne ou tableau de lignes. */
export function joinText(value: Json | undefined): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.filter((v) => typeof v === "string").join("") : "";
}

export function cellType(cell: Cell): CellType {
  const type = cell.json.cell_type;
  return type === "markdown" || type === "raw" ? type : "code";
}

export function cellSource(cell: Cell): string {
  return joinText(cell.json.source);
}

/** Applique `fn` à la cellule `key` ; le modèle est rendu tel quel si rien ne change. */
export function updateCell(
  model: NotebookModel,
  key: string,
  fn: (cell: Cell) => Cell,
): NotebookModel {
  let changed = false;
  const cells = model.cells.map((cell) => {
    if (cell.key !== key) return cell;
    const next = fn(cell);
    if (next !== cell) changed = true;
    return next;
  });
  return changed ? { ...model, cells } : model;
}

export function setSource(model: NotebookModel, key: string, text: string): NotebookModel {
  return updateCell(model, key, (cell) =>
    cellSource(cell) === text
      ? cell
      : { ...cell, json: { ...cell.json, source: splitLines(text) } },
  );
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Nouvel `id` nbformat 4.5 : 8 caractères aléatoires, absent du notebook. */
function newCellId(model: NotebookModel): string {
  const taken = new Set(model.cells.map((c) => c.key));
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
    if (!taken.has(id)) return id;
  }
}

/** Champs propres au type : une cellule de code a `outputs` et `execution_count`, les autres non. */
function retype(json: JsonObject, type: CellType): JsonObject {
  const rest = { ...json };
  delete rest.outputs;
  delete rest.execution_count;
  return type === "code"
    ? { ...rest, cell_type: type, execution_count: null, outputs: [] }
    : { ...rest, cell_type: type };
}

/** Insère une cellule vide au rang `index`. */
export function addCell(model: NotebookModel, index: number, type: CellType): NotebookModel {
  const minor = model.json.nbformat_minor;
  const withId = model.json.nbformat === 4 && typeof minor === "number" && minor >= 5;
  const key = withId ? newCellId(model) : sessionKey();
  const json = retype({ metadata: {}, source: [], ...(withId ? { id: key } : {}) }, type);
  const cells = [...model.cells];
  cells.splice(index, 0, { key, json });
  return { ...model, cells };
}

export function removeCell(model: NotebookModel, key: string): NotebookModel {
  const cells = model.cells.filter((c) => c.key !== key);
  return cells.length === model.cells.length ? model : { ...model, cells };
}

/** Échange la cellule avec sa voisine (`-1` : monter, `1` : descendre) ; rien aux bords. */
export function moveCell(model: NotebookModel, key: string, delta: -1 | 1): NotebookModel {
  const index = model.cells.findIndex((c) => c.key === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= model.cells.length) return model;
  const cells = [...model.cells];
  [cells[index], cells[target]] = [cells[target]!, cells[index]!];
  return { ...model, cells };
}

export function changeCellType(model: NotebookModel, key: string, type: CellType): NotebookModel {
  return updateCell(model, key, (cell) =>
    cellType(cell) === type
      ? cell
      : { ...cell, json: retype(cell.json, type), clearPending: false },
  );
}

/** « Effacer les sorties » : sorties vides et compteurs nuls dans toutes les cellules de code. */
export function clearAllOutputs(model: NotebookModel): NotebookModel {
  let changed = false;
  const cells = model.cells.map((cell) => {
    if (cellType(cell) !== "code") return cell;
    const outputs = cell.json.outputs;
    if ((!Array.isArray(outputs) || outputs.length === 0) && cell.json.execution_count === null) {
      return cell;
    }
    changed = true;
    return { ...cell, json: { ...cell.json, outputs: [], execution_count: null } };
  });
  return changed ? { ...model, cells } : model;
}
