// Arbre JSON / YAML (docs/specs/apercu-donnees.md) : fonctions pures. Une ligne = un nœud,
// aplatie par `flattenTree` puis virtualisée par la vue ; l'état déplié est un ensemble de chemins.

/** Chemin de la racine. Un enfant ajoute `/<clé encodée>` : stable tant que la clé ne change pas. */
export const ROOT_PATH = "";

/** Au-delà de cette longueur (JSON compris), une valeur est tronquée par `…` (texte complet en infobulle). */
const MAX_TEXT = 200;
/** Lignes visibles au plus dans l'état initial. */
const INITIAL_ROWS = 200;

export type TreeRow = {
  path: string;
  depth: number;
  /** Clé d'objet ou index de tableau ; absent pour la racine. */
  label?: string;
  labelKind?: "key" | "index";
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  /** Conteneur : `{ 3 }`, `[ 12 ]`, `{ }` ou `[ ]`. */
  summary?: string;
  /** Valeur simple telle qu'affichée : chaîne entre guillemets (JSON), nombre, `true`, `null`. */
  text?: string;
  /** Texte complet d'une valeur tronquée. */
  full?: string;
  /** Conteneur non vide : il a un chevron. */
  expandable: boolean;
  expanded: boolean;
};

/** Chemins ouverts, et chemins de tous les conteneurs connus (pour distinguer les nouveautés). */
export type TreeState = { expanded: Set<string>; known: Set<string> };

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function sizeOf(container: Container): number {
  return Array.isArray(container) ? container.length : Object.keys(container).length;
}

/** Enfants directs : clé ou index, valeur. */
function entriesOf(container: Container): [string, unknown][] {
  return Array.isArray(container)
    ? container.map((item, index) => [String(index), item])
    : Object.entries(container);
}

function childPath(parent: string, key: string): string {
  return `${parent}/${encodeURIComponent(key)}`;
}

type Frame = {
  value: unknown;
  path: string;
  depth: number;
  label?: string;
  kind?: "key" | "index";
};

function childFrames(frame: Frame, container: Container): Frame[] {
  const kind = Array.isArray(container) ? "index" : "key";
  return entriesOf(container).map(([label, value]) => ({
    value,
    path: childPath(frame.path, label),
    depth: frame.depth + 1,
    label,
    kind,
  }));
}

function toRow(frame: Frame, expanded: ReadonlySet<string>): TreeRow {
  const { value, path, depth, label, kind } = frame;
  const base = { path, depth, label, labelKind: kind };
  if (isContainer(value)) {
    const size = sizeOf(value);
    const array = Array.isArray(value);
    const [open, close] = array ? ["[", "]"] : ["{", "}"];
    return {
      ...base,
      type: array ? "array" : "object",
      summary: size === 0 ? `${open} ${close}` : `${open} ${size} ${close}`,
      expandable: size > 0,
      expanded: size > 0 && expanded.has(path),
    };
  }
  const simple = { ...base, expandable: false, expanded: false };
  if (value === null) return { ...simple, type: "null", text: "null" };
  if (typeof value === "number") return { ...simple, type: "number", text: String(value) };
  if (typeof value === "boolean") return { ...simple, type: "boolean", text: String(value) };
  // Chaîne, ou valeur que JSON et YAML ne produisent pas : affichée comme une chaîne.
  const json = JSON.stringify(typeof value === "string" ? value : String(value));
  return json.length > MAX_TEXT
    ? { ...simple, type: "string", text: `${json.slice(0, MAX_TEXT)}…`, full: json }
    : { ...simple, type: "string", text: json };
}

/**
 * Lignes visibles de l'arbre, dans l'ordre d'affichage : un nœud replié (absent de `expanded`)
 * masque ses enfants. Itératif : un document très imbriqué ne déborde pas la pile.
 */
export function flattenTree(value: unknown, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: Frame[] = [{ value, path: ROOT_PATH, depth: 0 }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const row = toRow(frame, expanded);
    rows.push(row);
    if (row.expanded && isContainer(frame.value)) {
      const children = childFrames(frame, frame.value);
      for (const child of [...children].reverse()) stack.push(child);
    }
  }
  return rows;
}

/** Tous les conteneurs du document (vides compris) : chemin et nombre d'enfants. */
function containers(value: unknown): { path: string; depth: number; size: number }[] {
  const found: { path: string; depth: number; size: number }[] = [];
  const stack: Frame[] = [{ value, path: ROOT_PATH, depth: 0 }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (!isContainer(frame.value)) continue;
    found.push({ path: frame.path, depth: frame.depth, size: sizeOf(frame.value) });
    // Une boucle : `push(...)` déborderait la pile pour un tableau de plusieurs centaines de milliers d'éléments.
    for (const child of childFrames(frame, frame.value)) stack.push(child);
  }
  return found;
}

/**
 * Chemins ouverts au départ : la racine, puis chaque niveau suivant en entier tant que l'arbre
 * visible tient en `maxRows` lignes. Un niveau est ouvert en entier ou pas du tout.
 */
function initialExpanded(value: unknown, maxRows: number): Set<string> {
  const expanded = new Set<string>();
  if (!isContainer(value) || sizeOf(value) === 0) return expanded;
  expanded.add(ROOT_PATH);
  let visible = 1 + sizeOf(value);
  const root: Frame = { value, path: ROOT_PATH, depth: 0 };
  const nonEmpty = (frames: Frame[]) =>
    frames.filter((f) => isContainer(f.value) && sizeOf(f.value) > 0);
  let level = nonEmpty(childFrames(root, value));
  while (level.length > 0) {
    const added = level.reduce((sum, f) => sum + sizeOf(f.value as Container), 0);
    if (visible + added > maxRows) break;
    visible += added;
    level.forEach((f) => expanded.add(f.path));
    level = nonEmpty(level.flatMap((f) => childFrames(f, f.value as Container)));
  }
  return expanded;
}

/** État d'un document qu'on ouvre : niveaux ouverts jusqu'à 200 lignes visibles. */
export function initialState(value: unknown): TreeState {
  return {
    expanded: initialExpanded(value, INITIAL_ROWS),
    known: new Set(containers(value).map((c) => c.path)),
  };
}

/** « Tout déplier » : tous les conteneurs non vides. */
export function expandAll(value: unknown): Set<string> {
  return new Set(
    containers(value)
      .filter((c) => c.size > 0)
      .map((c) => c.path),
  );
}

/** « Tout replier » : la racine seule reste dépliée. */
export function collapseAll(value: unknown): Set<string> {
  return isContainer(value) && sizeOf(value) > 0 ? new Set([ROOT_PATH]) : new Set();
}

/** Ensemble avec `path` ouvert s'il était fermé, fermé s'il était ouvert. L'original ne change pas. */
export function toggle(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(path)) next.add(path);
  return next;
}

/**
 * Nouvel état après un changement du texte : les chemins connus gardent leur état, ceux qui
 * n'existent plus sont oubliés, et un conteneur nouveau s'ouvre s'il est la racine ou un enfant
 * direct de la racine.
 */
export function reconcile(value: unknown, previous: TreeState): TreeState {
  const all = containers(value);
  const expanded = new Set<string>();
  for (const { path, depth, size } of all) {
    if (size === 0) continue;
    if (previous.known.has(path) ? previous.expanded.has(path) : depth <= 1) expanded.add(path);
  }
  return { expanded, known: new Set(all.map((c) => c.path)) };
}
