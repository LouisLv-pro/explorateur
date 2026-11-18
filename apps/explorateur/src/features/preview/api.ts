import { queryOptions, useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { unwrap } from "@/lib/ipc";

/** Requête de l'aperçu d'un fichier (partagée avec les liens Markdown, qui amorcent le cache). */
export function filePreviewQuery(path: string) {
  return queryOptions({
    queryKey: ["open_file", path],
    queryFn: async () => unwrap(await commands.openFile(path)),
    // Un fichier supprimé ou refusé ne se corrige pas en réessayant.
    retry: false,
    // Lu il y a moins d'une seconde (survol de l'arborescence juste avant le clic) : pas de
    // seconde lecture à l'ouverture. Un changement sur le disque relit quand même (`DiskWatch`).
    staleTime: 1000,
  });
}

/**
 * Rendu HTML d'une présentation. La révision (`version`, du rechargement automatique) est dans
 * la clé : un fichier modifié relance le rendu. Un rendu déjà vu reste affiché pendant le suivant.
 */
export function usePresentationRender(path: string, version: number, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["render_presentation", path, version],
    queryFn: async () => unwrap(await commands.renderPresentation(path)),
    retry: false,
    // Le cache disque de Rust garde le rendu : pas de relance tant que la révision est la même.
    staleTime: Infinity,
  });
}

/** Contenu du fichier courant. Un fichier déjà vu s'affiche aussitôt, relu en arrière-plan. */
export function useFilePreview(path: string) {
  return useQuery(filePreviewQuery(path));
}
