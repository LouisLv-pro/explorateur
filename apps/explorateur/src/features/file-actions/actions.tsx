import { Fragment, useCallback, useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@/bindings";
import { commands } from "@/bindings";
import i18n from "@/i18n";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { shortcutHint } from "@/features/shortcuts/shortcuts";
import { CodeLinkContextItems, CodeLinkDropdownItems } from "./codeLinks";
import { globalAction } from "@/features/shortcuts/useShortcuts";
import { baseName, relativePath } from "@/lib/paths";
import { useWorkspace } from "@/features/workspace/context";

/** Une action sur un fichier ou un dossier, affichée dans un menu. */
export type FileAction = {
  id:
    | "reveal"
    | "open"
    | "copy-path"
    | "copy-relative"
    | "trash"
    | "issue-from-selection"
    | "copy-github-link";
  label: string;
  /** Entrée grisée (gestes « depuis le code » qui ne peuvent pas aboutir). */
  disabled?: boolean;
  /** Raccourci affiché à droite de l'entrée. */
  shortcut?: string;
  run: () => void;
};

/** Raccourcis affichés dans les menus, tirés de la table (`features/shortcuts/shortcuts.ts`). */
export const SHORTCUTS = {
  reveal: shortcutHint("reveal-in-finder"),
  copyPath: shortcutHint("copy-path"),
  copyRelative: shortcutHint("copy-relative-path"),
  trash: shortcutHint("trash"),
} as const;

/** Actions d'un fichier ou d'un dossier, avec leur retour (message bref, bannière d'erreur). */
export function useFileActions() {
  // Abonne le composant à la langue : les libellés sont traduits à chaque appel d'`actionsFor`.
  useTranslation("files");
  const { root, notify, showError, requestTrash } = useWorkspace();
  const rootPath = root?.path ?? "/";

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify(i18n.t("files:pathCopied"));
      } catch {
        showError(i18n.t("common:copyFailed"));
      }
    },
    [notify, showError],
  );

  const report = useCallback(
    (error: AppError) =>
      showError(
        error.kind === "NotFound" ? i18n.t("files:fileGone") : i18n.t("common:actionFailed"),
      ),
    [showError],
  );

  const reveal = useCallback(
    async (path: string) => {
      const result = await commands.revealInFinder(path);
      if (result.status === "error") report(result.error);
    },
    [report],
  );

  const openDefault = useCallback(
    async (path: string) => {
      const result = await commands.openWithDefaultApp(path);
      if (result.status === "error") report(result.error);
    },
    [report],
  );

  const copyPath = useCallback((path: string) => copy(path), [copy]);
  const copyRelative = useCallback(
    (path: string) => copy(relativePath(path, rootPath)),
    [copy, rootPath],
  );

  /** Liste des actions pour `path` : pas d'ouverture avec l'app par défaut pour un dossier. */
  const actionsFor = useCallback(
    (path: string, isDir: boolean): FileAction[] => {
      const actions: FileAction[] = [
        {
          id: "reveal",
          label: i18n.t("files:actions.reveal"),
          shortcut: SHORTCUTS.reveal,
          run: () => void reveal(path),
        },
      ];
      if (!isDir) {
        actions.push({
          id: "open",
          label: i18n.t("files:actions.open"),
          run: () => void openDefault(path),
        });
      }
      actions.push(
        {
          id: "copy-path",
          label: i18n.t("files:actions.copyPath"),
          shortcut: SHORTCUTS.copyPath,
          run: () => void copyPath(path),
        },
        {
          id: "copy-relative",
          label: i18n.t("files:actions.copyRelative"),
          shortcut: SHORTCUTS.copyRelative,
          run: () => void copyRelative(path),
        },
        {
          id: "trash",
          label: i18n.t("files:actions.trash"),
          shortcut: SHORTCUTS.trash,
          run: () => requestTrash({ path, name: baseName(path), isDir }),
        },
      );
      return actions;
    },
    [reveal, openDefault, copyPath, copyRelative, requestTrash],
  );

  return { actionsFor, reveal, copyPath, copyRelative };
}

/**
 * Raccourcis ⌥⌘R, ⌥⌘C, ⌥⇧⌘C et ⌘⌫ (corbeille) sur le fichier de l'onglet actif (sans effet
 * sans onglet). ⌘⌫ est ignoré dans un champ ou l'éditeur (table des raccourcis) : il y efface
 * jusqu'au début de la ligne. Écouteur d'avant la table : il agit même avec un menu ouvert.
 */
export function useFileShortcuts() {
  const { currentFile, requestTrash } = useWorkspace();
  const { reveal, copyPath, copyRelative } = useFileActions();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!currentFile) return;
    const action = globalAction(event);
    if (action === "trash") {
      event.preventDefault();
      requestTrash({ path: currentFile.path, name: currentFile.name, isDir: false });
    } else if (action === "reveal-in-finder") {
      event.preventDefault();
      void reveal(currentFile.path);
    } else if (action === "copy-path" || action === "copy-relative-path") {
      event.preventDefault();
      void (action === "copy-relative-path"
        ? copyRelative(currentFile.path)
        : copyPath(currentFile.path));
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Entrées d'un menu contextuel (clic droit). `code` : les gestes « depuis le code » (issue et
 * lien GitHub de la sélection, lot 3 des issues) s'ajoutent avant la corbeille.
 */
export function ContextActionItems({
  path,
  isDir,
  code = false,
}: {
  path: string;
  isDir: boolean;
  code?: boolean;
}) {
  // Dans le contenu du menu : monté à l'ouverture seulement, pas pour chaque ligne de l'arbre.
  const { actionsFor } = useFileActions();
  return actionsFor(path, isDir).map((action) => (
    <Fragment key={action.id}>
      {action.id === "trash" && code && (
        <>
          <ContextMenuSeparator />
          <CodeLinkContextItems path={path} />
        </>
      )}
      {action.id === "trash" && <ContextMenuSeparator />}
      <ContextMenuItem onSelect={action.run}>
        {action.label}
        {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
      </ContextMenuItem>
    </Fragment>
  ));
}

/** Entrées d'un menu déroulant (bouton « Actions »). `codePath` : voir `ContextActionItems`. */
export function DropdownActionItems({
  actions,
  codePath,
}: {
  actions: FileAction[];
  codePath?: string;
}) {
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.id === "trash" && codePath !== undefined && (
        <>
          <DropdownMenuSeparator />
          <CodeLinkDropdownItems path={codePath} />
        </>
      )}
      {action.id === "trash" && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={action.run}>
        {action.label}
        {action.shortcut && <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>}
      </DropdownMenuItem>
    </Fragment>
  ));
}
