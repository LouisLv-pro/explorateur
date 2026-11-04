import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { requestEditorFocus } from "@/features/editor/documents";
import { nameErrorMessage, writeErrorMessage } from "@/features/file-actions/errors";
import { previewKindOf } from "@/features/quick-open/match";
import { useWorkspace } from "@/features/workspace/context";
import { baseName, parentPath } from "@/lib/paths";

/** Ce que le champ de nom de l'arborescence est en train de faire. */
export type Editing =
  | { mode: "create"; dir: string; kind: "file" | "dir" }
  | { mode: "rename"; path: string; isDir: boolean };

type TreeEdit = {
  editing: Editing | null;
  /** Ouvre un champ de nom en tête de `dir` (qui se déplie). */
  startCreate: (dir: string, kind: "file" | "dir") => void;
  startRename: (path: string, isDir: boolean) => void;
  cancel: () => void;
  /** Valide le nom : message d'erreur à montrer sous le champ, ou `null` si c'est fini. */
  submit: (name: string) => Promise<string | null>;
};

const TreeEditContext = createContext<TreeEdit | null>(null);

export function useTreeEdit(): TreeEdit {
  const edit = useContext(TreeEditContext);
  if (!edit) throw new Error("useTreeEdit hors de <TreeEditProvider>");
  return edit;
}

/**
 * Création et renommage depuis l'arborescence (specs creation.md et renommage.md). Un seul
 * champ de nom à la fois. `onExpand` déplie un dossier (état du panneau).
 */
export function TreeEditProvider({
  onExpand,
  children,
}: {
  onExpand: (path: string) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { openFile, renameTabs, showError } = useWorkspace();
  const [editing, setEditing] = useState<Editing | null>(null);

  /** Relit le dossier tout de suite, sans attendre la surveillance du disque. */
  const refresh = useCallback(
    (dir: string) => queryClient.invalidateQueries({ queryKey: ["list_directory", dir] }),
    [queryClient],
  );

  const startCreate = useCallback(
    (dir: string, kind: "file" | "dir") => {
      onExpand(dir);
      setEditing({ mode: "create", dir, kind });
    },
    [onExpand],
  );

  const startRename = useCallback(
    (path: string, isDir: boolean) => setEditing({ mode: "rename", path, isDir }),
    [],
  );

  const cancel = useCallback(() => setEditing(null), []);

  const submit = useCallback(
    async (name: string): Promise<string | null> => {
      if (!editing) return null;

      if (editing.mode === "rename") {
        const { path } = editing;
        if (name.trim() === baseName(path)) {
          setEditing(null);
          return null;
        }
        const result = await commands.renameEntry(path, name);
        if (result.status === "error") {
          const message = nameErrorMessage(result.error);
          if (message) return message;
          showError(writeErrorMessage(result.error));
          setEditing(null);
          return null;
        }
        await refresh(parentPath(path));
        renameTabs(path, result.data);
        setEditing(null);
        return null;
      }

      const { dir, kind } = editing;
      const result =
        kind === "file"
          ? await commands.createFile(dir, name)
          : await commands.createDir(dir, name);
      if (result.status === "error") {
        const message = nameErrorMessage(result.error);
        if (message) return message;
        showError(writeErrorMessage(result.error));
        setEditing(null);
        return null;
      }
      await refresh(dir);
      setEditing(null);
      const path = result.data;
      if (kind === "dir") {
        onExpand(path);
      } else {
        // L'onglet s'ouvre épinglé, son éditeur prend le focus (editeur.md).
        const fileName = baseName(path);
        requestEditorFocus(path);
        openFile(
          { name: fileName, path, is_dir: false, preview_kind: previewKindOf(fileName) },
          { pin: true },
        );
      }
      return null;
    },
    [editing, onExpand, openFile, refresh, renameTabs, showError],
  );

  const value = useMemo(
    () => ({ editing, startCreate, startRename, cancel, submit }),
    [editing, startCreate, startRename, cancel, submit],
  );
  return <TreeEditContext value={value}>{children}</TreeEditContext>;
}
