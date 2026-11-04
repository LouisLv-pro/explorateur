import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { unwrap } from "@/lib/ipc";

/** Entrées directes d'un dossier, chargées à la première ouverture. */
export function useDirectory(path: string, showHidden: boolean) {
  return useQuery({
    queryKey: ["list_directory", path, showHidden],
    queryFn: async () => unwrap(await commands.listDirectory(path, showHidden)),
    // Relu au plus tôt 30 s après, en repliant puis dépliant le dossier.
    staleTime: 30_000,
    // Basculer les éléments masqués garde l'ancienne liste affichée pendant la relecture.
    placeholderData: keepPreviousData,
    // Un accès refusé ne se corrige pas en réessayant.
    retry: false,
  });
}
