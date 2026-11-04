import { useTranslation } from "react-i18next";
import { useCodeLinkActions } from "@/features/file-actions/codeLinks";
import type { FileAction } from "@/features/file-actions/actions";
import type { Command } from "./registry";
import { useCommand } from "./store";

/**
 * « Copier le lien GitHub » et « Créer une issue depuis la sélection » dans la palette (spec
 * permalien-github.md). Même geste que le menu Actions (`useCodeLinkActions`) ; une action qui ne
 * peut pas aboutir est absente, pas grisée. Monté par la palette à son ouverture seulement : les
 * requêtes git et `gh` du hook ne partent pas palette fermée. Ne rend rien.
 */
export function CodeLinkCommands({ path }: { path: string }) {
  const actions = useCodeLinkActions(path);
  const { t } = useTranslation("shortcuts");
  const group = t("groups.file");
  // Un `useCommand` par action : un hook ne s'appelle pas dans une boucle.
  useCommand(
    commandOf(
      actions.find((action) => action.id === "issue-from-selection"),
      group,
    ),
  );
  useCommand(
    commandOf(
      actions.find((action) => action.id === "copy-github-link"),
      group,
    ),
  );
  return null;
}

function commandOf(action: FileAction | undefined, group: string): Command | null {
  if (!action || action.disabled) return null;
  return { id: action.id, label: action.label, group, run: action.run };
}
