// Arborescence au clavier (docs/specs/raccourcis.md) : logique pure sur la liste des entrées
// visibles, dans l'ordre de l'écran (les enfants d'un dossier déplié suivent le dossier).

/** Une entrée affichée de l'arborescence. */
export type TreeRow = {
  path: string;
  isDir: boolean;
  /** Dossier déplié (toujours faux pour un fichier). */
  expanded: boolean;
  /** Niveau : 0 pour les entrées de la racine. */
  depth: number;
};

export type TreeDirection = "previous" | "next" | "expand" | "collapse";

/** Ce que fait une flèche : donner le focus à une entrée, déplier ou replier un dossier. */
export type TreeMove =
  | { kind: "focus"; path: string }
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string };

/**
 * Effet d'une flèche sur l'entrée `current`. `null` : rien à faire (extrémité, fichier pour
 * `→`, entrée de premier niveau pour `←`, entrée inconnue).
 */
export function treeMove(
  rows: readonly TreeRow[],
  current: string,
  direction: TreeDirection,
): TreeMove | null {
  const index = rows.findIndex((row) => row.path === current);
  const row = rows[index];
  if (row === undefined) return null;
  const focus = (target: TreeRow | undefined): TreeMove | null =>
    target ? { kind: "focus", path: target.path } : null;

  switch (direction) {
    case "previous":
      return focus(rows[index - 1]);
    case "next":
      return focus(rows[index + 1]);
    case "expand": {
      if (!row.isDir) return null;
      if (!row.expanded) return { kind: "expand", path: row.path };
      const child = rows[index + 1];
      return child && child.depth === row.depth + 1 ? focus(child) : null;
    }
    case "collapse": {
      if (row.isDir && row.expanded) return { kind: "collapse", path: row.path };
      // Parent : la plus proche entrée au-dessus, d'un niveau de moins.
      for (let i = index - 1; i >= 0; i--) {
        const candidate = rows[i];
        if (candidate && candidate.depth < row.depth) return focus(candidate);
      }
      return null;
    }
  }
}

/** Minuscules sans accents : `É` et `e` se valent. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Entrée visée par les lettres tapées (saut par frappe, comme dans le Finder) : la première
 * dont le nom commence par `word`, sans tenir compte de la casse ni des accents. Au premier
 * caractère (`first`), la recherche part de l'entrée qui suit `current` ; ensuite, de `current`
 * elle-même, qui reste si elle convient encore. Elle repart du haut en bas de liste, `current`
 * comprise en dernier. `null` : aucune entrée ne convient (rien ne bouge).
 */
export function typeAheadTarget(
  rows: readonly TreeRow[],
  current: string,
  word: string,
  first: boolean,
): string | null {
  const wanted = fold(word);
  if (wanted === "" || rows.length === 0) return null;
  const index = rows.findIndex((row) => row.path === current);
  // Entrée inconnue : depuis le haut.
  const start = index < 0 ? 0 : first ? index + 1 : index;
  for (let step = 0; step < rows.length; step++) {
    const row = rows[(start + step) % rows.length];
    if (row === undefined) continue;
    const name = row.path.slice(row.path.lastIndexOf("/") + 1);
    if (fold(name).startsWith(wanted)) return row.path;
  }
  return null;
}

/** Dossiers entre `root` (exclu) et `path` (exclu), du plus haut au plus bas ; vide hors de `root`. */
export function ancestorDirs(path: string, root: string): string[] {
  if (!path.startsWith(`${root}/`)) return [];
  const parts = path.slice(root.length + 1).split("/");
  const dirs: string[] = [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
    dirs.push(current);
  }
  return dirs;
}
