import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { unwrap } from "@/lib/ipc";

/** Silence nécessaire après la dernière frappe avant de relancer la recherche. */
export const SEARCH_DELAY_MS = 250;
/** Longueur minimale d'une requête, en caractères (espaces compris), comme en Rust. */
export const MIN_QUERY_CHARS = 2;

/** `value`, mais seulement après `delay` ms sans changement. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function isQueryLongEnough(query: string): boolean {
  return [...query].length >= MIN_QUERY_CHARS;
}

/** Occurrences de `query` dans les fichiers de `root` (2 000 au plus). */
export function useSearchContent(
  root: string,
  query: string,
  caseSensitive: boolean,
  showHidden: boolean,
) {
  const debounced = useDebounced(query, SEARCH_DELAY_MS);
  return useQuery({
    queryKey: ["search_content", root, debounced, caseSensitive, showHidden],
    queryFn: async () =>
      unwrap(await commands.searchContent(root, debounced, caseSensitive, showHidden)),
    enabled: isQueryLongEnough(debounced),
    // Les anciens résultats restent affichés pendant le calcul : pas de clignotement.
    placeholderData: keepPreviousData,
    retry: false,
  });
}
