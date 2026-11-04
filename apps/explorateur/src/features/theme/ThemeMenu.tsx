import type { ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
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
import { shortcutHint } from "@/features/shortcuts/shortcuts";
import type { ThemeChoice } from "@/lib/theme";

/** Icône Lucide de chaque thème (docs/specs/mode-sombre.md), dans l'ordre du menu. */
const THEMES: Record<ThemeChoice, ReactNode> = {
  system: <Monitor />,
  light: <Sun />,
  dark: <Moon />,
};

function isThemeChoice(value: string): value is ThemeChoice {
  return value in THEMES;
}

/** Bouton icône du thème courant, qui ouvre le menu Système / Clair / Sombre. */
export function ThemeMenu({
  choice,
  onChoose,
  side = "top",
  align = side === "top" ? "start" : "end",
}: {
  choice: ThemeChoice;
  onChoose: (choice: ThemeChoice) => void;
  /**
   * Côté de l'infobulle et du menu : au-dessus dans le pied de l'arborescence (aligné à
   * gauche), au-dessous sur l'accueil (bouton en haut à droite, aligné à droite).
   */
  side?: "top" | "bottom";
  /** Alignement du menu ; à gauche dans la barre d'onglets quand l'arborescence est masquée. */
  align?: "start" | "end";
}) {
  const { t } = useTranslation("app");
  // Le nom d'un thème se lit au rendu, dans la langue active.
  const name = (value: ThemeChoice) => t(`theme.${value}`);
  const label = t("theme.current", { name: name(choice) });
  const hint = `${label} (${shortcutHint("toggle-theme")})`;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label} className="text-mute">
              {THEMES[choice]}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>{hint}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={side} align={align} className="w-40">
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            if (isThemeChoice(value)) onChoose(value);
          }}
        >
          {(Object.keys(THEMES) as ThemeChoice[]).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {THEMES[value]}
              {name(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
