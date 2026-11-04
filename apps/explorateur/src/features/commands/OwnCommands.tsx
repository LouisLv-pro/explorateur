import { useTranslation } from "react-i18next";
import { useFileActions } from "@/features/file-actions/actions";
import { saveDocument } from "@/features/editor/documents";
import { tabKey } from "@/features/tabs/tabs";
import { useWorkspace } from "@/features/workspace/context";
import { availabilityOf, isAvailable, shortcutLabel } from "./registry";
import { useCommand } from "./store";

/**
 * Les commandes que la palette fait elle-même, faute de raccourci rejouable : ⌘W et ⌘S sont pris
 * par le menu natif, et « Ouvrir avec l'app par défaut » n'a pas de raccourci. Ne rend rien.
 */
export function OwnCommands() {
  const { root, activeTab, currentFile, closeTab } = useWorkspace();
  // Se redessine au changement de langue : libellés et groupes sont relus à chaque rendu.
  const { t } = useTranslation("shortcuts");
  const { actionsFor } = useFileActions();
  const state = availabilityOf(root !== null, activeTab);

  const openDefault =
    state.tab === "file" && currentFile !== null
      ? actionsFor(currentFile.path, false).find((action) => action.id === "open")
      : undefined;
  useCommand(
    openDefault
      ? {
          id: "open-default-app",
          label: openDefault.label,
          group: t("groups.file"),
          run: openDefault.run,
        }
      : null,
  );

  useCommand(
    activeTab && isAvailable("close-tab", state)
      ? {
          id: "close-tab",
          label: shortcutLabel("close-tab"),
          group: t("groups.tabs"),
          shortcut: "close-tab",
          // La demande de confirmation avec des modifications est celle du contexte.
          run: () => closeTab(activeTab.path),
        }
      : null,
  );

  useCommand(
    activeTab && isAvailable("save", state)
      ? {
          id: "save",
          label: shortcutLabel("save"),
          group: t("groups.file"),
          shortcut: "save",
          run: () => void saveDocument(tabKey(activeTab), activeTab.path),
        }
      : null,
  );

  return null;
}
