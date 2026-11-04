// Mode sombre (docs/specs/mode-sombre.md de chaque app) : logique pure, sans React ni DOM.
// Partagée par memo, taches et diagrammes (docs/decisions/0004-theme-partage.md) : la clé de
// stockage (`<app>.theme`) est un paramètre.

/** Choix de l'utilisateur. */
export type ThemeChoice = "system" | "light" | "dark";
/** Thème réellement affiché, une fois Système résolu avec l'apparence de macOS. */
export type AppliedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemeChoice = "system";

/** Ordre du bouton : Système → Clair → Sombre → Système. */
const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Ce dont `watchSystemTheme` a besoin d'un `MediaQueryList`. */
type ChangeListener = (event: { matches: boolean }) => void;
type SystemThemeMedia = {
  addEventListener: (type: "change", listener: ChangeListener) => void;
  removeEventListener: (type: "change", listener: ChangeListener) => void;
};

function isThemeChoice(value: string): value is ThemeChoice {
  return (CHOICES as readonly string[]).includes(value);
}

/**
 * Relit le choix enregistré sous `key` (texte brut, sans JSON). Valeur absente, inconnue ou
 * lecture qui lève : Système.
 */
export function loadTheme(storage: ReadableStorage, key: string): ThemeChoice {
  try {
    const raw = storage.getItem(key);
    return raw !== null && isThemeChoice(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(storage: WritableStorage, key: string, choice: ThemeChoice): void {
  storage.setItem(key, choice);
}

/** Système suit macOS ; Clair et Sombre l'ignorent. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): AppliedTheme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

/** Pose ou retire la classe `dark` ; les autres classes de l'élément restent en place. */
export function applyThemeClass(
  root: { classList: Pick<DOMTokenList, "toggle"> },
  applied: AppliedTheme,
): void {
  root.classList.toggle("dark", applied === "dark");
}

/**
 * Appelle `onChange` à chaque changement d'apparence de macOS (pas à l'abonnement).
 * Renvoie la fonction de désabonnement.
 */
export function watchSystemTheme(
  media: SystemThemeMedia,
  onChange: (prefersDark: boolean) => void,
): () => void {
  const listener: ChangeListener = (event) => onChange(event.matches);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
