// Boutons des gestes du lot 2 (Indexer `+`, Désindexer `−`, Annuler les modifications `undo-2`),
// affichés au survol d'une ligne, d'un en-tête de diff ou d'un bloc. Hors de l'ordre de
// tabulation : la liste garde une seule ligne focalisable.
import { Minus, Plus, Undo2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChangeAction } from "./model";

const ICONS: Record<ChangeAction, LucideIcon> = { stage: Plus, unstage: Minus, discard: Undo2 };

export function ActionButtons({
  actions,
  onAction,
  hunk = false,
  className,
}: {
  actions: readonly ChangeAction[];
  onAction: (action: ChangeAction) => void;
  /** Boutons d'un bloc : libellés « ce bloc ». */
  hunk?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("git");
  const label = (action: ChangeAction) =>
    hunk ? t(`action.hunk.${action}`) : t(`action.file.${action}`);
  return (
    <span className={cn("items-center gap-0.5", className)}>
      {actions.map((action) => {
        const Icon = ICONS[action];
        return (
          <Tooltip key={action}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                tabIndex={-1}
                aria-label={label(action)}
                data-git-action={action}
                onClick={(event) => {
                  event.stopPropagation();
                  onAction(action);
                }}
                className="text-mute hover:text-ink"
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label(action)}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
