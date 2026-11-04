// Fichiers mémorisés qui existent encore (docs/specs/continuite.md) : le front relit leurs
// dossiers parents, éléments masqués compris, par le cache de TanStack Query.
import { queryOptions, useQueries, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { commands, type Entry } from "@/bindings";
import { unwrap } from "@/lib/ipc";
import { parentPath } from "@/lib/paths";

/** Liste d'un dossier, masqués compris (même clé que l'arborescence qui les affiche). */
export function parentListingQuery(dir: string) {
  return queryOptions({
    queryKey: ["list_directory", dir, true],
    queryFn: async () => unwrap(await commands.listDirectory(dir, true)),
    // Un dossier absent ne réapparaît pas en réessayant.
    retry: false,
    staleTime: 5000,
  });
}

/** Chemins listés par une liste de dossier ; `null` si la liste n'en est pas une. */
function listedPaths(listing: unknown): Set<string> | null {
  if (!Array.isArray(listing)) return null;
  return new Set((listing as Entry[]).map((entry) => entry.path));
}

const parentsOf = (paths: readonly string[]) => [...new Set(paths.map(parentPath))];

/**
 * Les chemins de `paths` que leur dossier parent liste encore. Parent absent ou illisible :
 * ses fichiers sont écartés.
 */
export async function existingPaths(
  queryClient: QueryClient,
  paths: readonly string[],
): Promise<Set<string>> {
  const listings = await Promise.all(
    parentsOf(paths).map(async (dir) => {
      try {
        return listedPaths(await queryClient.fetchQuery(parentListingQuery(dir)));
      } catch {
        return null;
      }
    }),
  );
  const listed = new Set(listings.flatMap((set) => (set ? [...set] : [])));
  return new Set(paths.filter((path) => listed.has(path)));
}

/**
 * Même vérification, pour l'affichage : `null` tant qu'un dossier parent n'est pas encore lu,
 * puis les chemins qui existent.
 */
export function useExistingPaths(paths: readonly string[]): Set<string> | null {
  const dirs = useMemo(() => parentsOf(paths), [paths]);
  const results = useQueries({ queries: dirs.map(parentListingQuery) });
  if (results.some((r) => r.isPending)) return null;
  // Une erreur (dossier absent) ne liste rien : ses fichiers sont écartés.
  const listed = new Set(results.flatMap((r) => [...(listedPaths(r.data) ?? [])]));
  return new Set(paths.filter((path) => listed.has(path)));
}
