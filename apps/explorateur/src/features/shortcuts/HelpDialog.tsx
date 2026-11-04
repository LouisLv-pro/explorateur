import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BROWSER_HELP_GROUP,
  GIT_HELP_GROUP,
  HELP_GROUPS,
  ISSUES_HELP_GROUP,
  TERMINAL_HELP_GROUP,
  shortcutHint,
} from "./shortcuts";

/** Bouton qui ouvre l'aide, à droite du bouton du thème. */
export function HelpButton({
  onClick,
  side = "top",
}: {
  onClick: () => void;
  /** Côté de l'infobulle : au-dessus dans le pied de l'arborescence, au-dessous ailleurs. */
  side?: "top" | "bottom";
}) {
  const { t } = useTranslation("shortcuts");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("help.title")}
          onClick={onClick}
          className="text-mute"
        >
          <CircleHelp />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {t("help.tooltip", { hint: shortcutHint("help") })}
      </TooltipContent>
    </Tooltip>
  );
}

/** Aide : les raccourcis par groupe, tirés de la même table que la correspondance des touches. */
export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Les groupes lisent la langue active à chaque rendu : `useTranslation` redessine l'aide.
  const { t } = useTranslation("shortcuts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("help.title")}</DialogTitle>
          <DialogDescription>{t("help.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {[
            ...HELP_GROUPS,
            TERMINAL_HELP_GROUP,
            GIT_HELP_GROUP,
            ISSUES_HELP_GROUP,
            BROWSER_HELP_GROUP,
          ].map(({ id, title, entries }) => (
            <section key={id} aria-label={title} className="grid gap-1">
              <h3 className="font-mono text-caption-mono text-mute uppercase">{title}</h3>
              <ul>
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 border-b border-hairline py-1.5 last:border-b-0"
                  >
                    <span className="text-body-sm text-body">{entry.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {entry.keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs bg-canvas-soft-2 px-1.5 text-caption-mono text-ink"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
