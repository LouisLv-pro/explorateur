import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { commands, type AppError } from "@/bindings";
import i18n from "@/i18n";
import { unwrap } from "@/lib/ipc";

export const recentFoldersKey = ["recent_folders"] as const;

export function useRecentFolders() {
  return useQuery({
    queryKey: recentFoldersKey,
    queryFn: async () => unwrap(await commands.listRecentFolders()),
  });
}

/** Dernier dossier ouvert, lu une seule fois au lancement. */
export function useLastRoot() {
  return useQuery({
    queryKey: ["last_root"],
    queryFn: async () => unwrap(await commands.lastRoot()),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRemoveRecentFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => unwrap(await commands.removeRecentFolder(path)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: recentFoldersKey }),
  });
}

/** Dossier personnel, pour abréger les chemins en `~`. */
export function useHomeDir() {
  return useQuery({ queryKey: ["home_dir"], queryFn: homeDir, staleTime: Infinity });
}

/** Message affiché quand un dossier ne s'ouvre pas, dans la langue active à l'appel. */
export function openErrorMessage(error: AppError): string {
  switch (error.kind) {
    case "NotFound":
      return i18n.t("app:folders.errors.notFound");
    case "PermissionDenied":
      return i18n.t("app:folders.errors.permissionDenied");
    case "NotADirectory":
      return i18n.t("app:folders.errors.notADirectory");
    default:
      return i18n.t("app:folders.errors.other");
  }
}
