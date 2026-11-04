// Dossiers dépliés de l'arborescence (docs/specs/continuite.md) : gardés par dossier racine dans
// le localStorage, relus au montage de `TreePanel`.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Entry } from "@/bindings";
import { parentPath } from "@/lib/paths";

/** Clé du localStorage : chemins dépliés par dossier racine. */
export const TREE_EXPANDED_KEY = "explorateur.tree-expanded";
/** Dossiers racines gardés au plus : le moins récemment utilisé part le premier. */
export const MAX_EXPANDED_ROOTS = 20;
/** Chemins gardés au plus par dossier racine : les derniers dépliés. */
export const MAX_EXPANDED = 500;

type Stored = Record<string, unknown>;

function readAll(storage: Pick<Storage, "getItem">): Stored {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TREE_EXPANDED_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Stored)
      : {};
  } catch {
    return {};
  }
}

/** Dossiers dépliés de `root` ; absents, illisibles ou stockage refusé : aucun. */
export function loadExpanded(storage: Pick<Storage, "getItem">, root: string): Set<string> {
  const paths = readAll(storage)[root];
  if (!Array.isArray(paths)) return new Set();
  return new Set(paths.filter((p): p is string => typeof p === "string"));
}

/**
 * Enregistre les dossiers dépliés de `root` (les 500 derniers), qui devient le plus récemment
 * utilisé ; au-delà de 20 dossiers racines, les plus anciens partent. Un échec est ignoré.
 */
export function saveExpanded(
  storage: Pick<Storage, "getItem" | "setItem">,
  root: string,
  paths: Iterable<string>,
): void {
  try {
    const all = readAll(storage);
    const keys = Object.keys(all)
      .filter((key) => key !== root)
      .slice(-(MAX_EXPANDED_ROOTS - 1));
    const kept: Stored = {};
    for (const key of keys) kept[key] = all[key];
    kept[root] = [...paths].slice(-MAX_EXPANDED);
    storage.setItem(TREE_EXPANDED_KEY, JSON.stringify(kept));
  } catch {
    // Non enregistré : les dossiers dépliés valent pour la session.
  }
}

/**
 * Écarte les dossiers que leur parent, déjà lu (`listing`), ne liste plus. Parent pas encore
 * lu : le dossier est gardé.
 */
export function pruneExpanded(
  paths: Iterable<string>,
  listing: (dir: string) => readonly Entry[] | undefined,
): string[] {
  return [...paths].filter((path) => {
    const entries = listing(parentPath(path));
    return !Array.isArray(entries) || entries.some((e) => e.path === path);
  });
}

function readExpanded(root: string): Set<string> {
  try {
    return loadExpanded(localStorage, root);
  } catch {
    return new Set();
  }
}

/**
 * Dossiers dépliés de `root`, relus au montage et enregistrés à chaque changement, sans ceux
 * qui n'existent plus. Seule la liste du parent masqués compris fait foi : sans les masqués,
 * un dossier `.github` déplié manquerait sans avoir disparu.
 */
export function useTreeExpanded(root: string) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readExpanded(root));
  useEffect(() => {
    const listing = (dir: string) =>
      queryClient.getQueryData<Entry[]>(["list_directory", dir, true]);
    try {
      saveExpanded(localStorage, root, pruneExpanded(expanded, listing));
    } catch {
      // Non enregistré.
    }
  }, [expanded, root, queryClient]);
  return [expanded, setExpanded] as const;
}
