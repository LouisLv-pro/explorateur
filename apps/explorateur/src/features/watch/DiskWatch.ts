import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands, events, type DiskChange } from "@/bindings";
import { recordChanges } from "./versions";

/**
 * Surveille le dossier racine tant qu'il est ouvert (monté dans `App.tsx`), et relit ce qui a
 * changé : listes des dossiers (`list_directory`) et fichiers ouverts (`open_file`). TanStack
 * Query ne relit que les requêtes montées : dossiers dépliés, onglet visible (les autres à leur
 * réaffichage). Image, PDF et page HTML suivent `versions.ts`.
 */
export function DiskWatch({ rootPath }: { rootPath: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    void commands.watchRoot(rootPath);
    return () => void commands.unwatchRoot();
  }, [rootPath]);

  useEffect(() => {
    const apply = ({ dirs, files }: DiskChange) => {
      for (const dir of dirs)
        void queryClient.invalidateQueries({ queryKey: ["list_directory", dir] });
      for (const file of files)
        void queryClient.invalidateQueries({ queryKey: ["open_file", file] });
      recordChanges(files);
      // Pastilles « modifié depuis votre dernière lecture », déjà recalculées par Rust.
      void queryClient.invalidateQueries({ queryKey: ["read_marks"] });
    };
    const unlisten = events.diskChanged.listen((event) => apply(event.payload));
    return () => void unlisten.then((off) => off());
  }, [queryClient]);

  return null;
}
