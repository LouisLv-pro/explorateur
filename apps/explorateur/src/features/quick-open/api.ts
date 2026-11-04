import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { unwrap } from "@/lib/ipc";

/** Silence nécessaire après la dernière frappe avant de relancer la recherche. */
export const SEARCH_DELAY_MS = 80;

/** `value`, mais seulement après `delay` ms sans changement. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Fichiers de `root` qui correspondent à `query` (50 au plus, déjà classés). */
export function useFindFiles(root: string, query: string, showHidden: boolean) {
  const debounced = useDebounced(query, SEARCH_DELAY_MS);
  return useQuery({
    queryKey: ["find_files", root, debounced, showHidden],
    queryFn: async () => unwrap(await commands.findFiles(root, debounced, showHidden)),
    enabled: debounced.trim() !== "",
    // Les anciens résultats restent affichés pendant le calcul : pas de clignotement.
    placeholderData: keepPreviousData,
    // Le disque change sans qu'on le sache : toujours relu à l'ouverture de la palette.
    gcTime: 0,
    retry: false,
  });
}
