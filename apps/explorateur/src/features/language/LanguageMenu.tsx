import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LANGUAGE_NAMES, LANGUAGES, type LanguageChoice, useLanguage } from "@/i18n";

const CHOICES: readonly LanguageChoice[] = ["system", ...LANGUAGES];

function isLanguageChoice(value: string): value is LanguageChoice {
  return (CHOICES as readonly string[]).includes(value);
}

/**
 * Bouton qui ouvre le menu System / English / Français (docs/specs/langue-interface.md), à
 * côté du menu du thème. Les noms de langue s'écrivent dans leur propre langue.
 */
export function LanguageMenu({
  side = "top",
  align = side === "top" ? "start" : "end",
}: {
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const { t } = useTranslation();
  const { choice, choose } = useLanguage();
  const name = (value: LanguageChoice) =>
    value === "system" ? t("language.system") : LANGUAGE_NAMES[value];
  const label = t("language.current", { name: name(choice) });
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label} className="text-mute">
              <Languages />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={side} align={align} className="w-40">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            if (isLanguageChoice(value)) choose(value);
          }}
        >
          {CHOICES.map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              lang={value === "system" ? undefined : value}
            >
              {name(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
