import { createContext, use, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { useShortcuts } from "@/features/shortcuts/useShortcuts";
import { oppositeTheme, THEME_KEY } from "./theme";
import { ThemeMenu } from "./ThemeMenu";

const ThemeContext = createContext<ReturnType<typeof useTheme> | null>(null);

/**
 * Thème de l'app et ⇧⌘L. Au-dessus de `Shell`, avec ses enfants reçus tout faits : changer de
 * thème ne redessine que les menus du thème, pas toute l'app (la couleur vient de la classe
 * `dark`, posée par `useTheme`). Le suivi de macOS reste actif quel que soit l'écran.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme(THEME_KEY);
  useShortcuts((action, event) => {
    if (action !== "toggle-theme") return;
    event.preventDefault();
    theme.choose(oppositeTheme(theme.applied));
  });
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

/** `ThemeMenu` branché sur le thème de l'app. */
export function AppThemeMenu(props: { side?: "top" | "bottom"; align?: "start" | "end" }) {
  const theme = use(ThemeContext);
  if (!theme) throw new Error("AppThemeMenu hors de <ThemeProvider>");
  return <ThemeMenu choice={theme.choice} onChoose={theme.choose} {...props} />;
}
