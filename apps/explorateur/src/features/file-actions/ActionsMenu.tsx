import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownActionItems, useFileActions } from "./actions";

/** Bouton « Actions » de l'en-tête de l'aperçu : menu des actions du fichier ouvert. */
export function ActionsMenu({ path }: { path: string }) {
  const { t } = useTranslation("files");
  const { actionsFor } = useFileActions();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions.menu")}
              className="text-mute"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("actions.menu")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownActionItems actions={actionsFor(path, false)} codePath={path} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
