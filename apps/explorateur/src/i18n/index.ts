// Langue de l'interface (docs/specs/langue-interface.md, décision 0019) : instance i18next
// partagée, choix enregistré sous `explorateur.language`, langue de macOS par défaut.
import { useSyncExternalStore } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

/** Clé du localStorage : `system`, `en` ou `fr`. */
export const LANGUAGE_KEY = "explorateur.language";

export type Language = "en" | "fr";
export type LanguageChoice = "system" | Language;

/** Langues connues, dans l'ordre du menu. */
export const LANGUAGES: readonly Language[] = ["en", "fr"];

/** Nom de chaque langue, écrit dans sa propre langue. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", fr: "Français" };

export const resources = { en, fr };
export const defaultNS = "common";

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...LANGUAGES],
  defaultNS,
  ns: Object.keys(en),
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

export default i18n;

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Langue affichée pour un choix : `en` ou `fr` tels quels ; `system`, la première langue de
 * `preferred` que l'app connaît (`fr-CA` donne `fr`), sinon l'anglais.
 */
export function resolveLanguage(choice: LanguageChoice, preferred: readonly string[]): Language {
  if (choice !== "system") return choice;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLanguage(base)) return base;
  }
  return "en";
}

/** Choix enregistré ; une valeur inconnue ou un stockage illisible donnent `system`. */
export function readLanguageChoice(): LanguageChoice {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_KEY) ?? null;
    return value !== null && isLanguage(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Langues préférées du système (`navigator.languages`), vide hors navigateur. */
export function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}

/** Langue active de l'instance (`en` ou `fr`). */
export function currentLanguage(): Language {
  const lang = i18n.resolvedLanguage ?? i18n.language;
  return isLanguage(lang) ? lang : "en";
}

/** Abonnés au changement de choix (le menu Langue). */
const listeners = new Set<() => void>();

/** Rust reconstruit le menu natif ; branché par `main.tsx` (hors tests). */
let syncNative: (lang: Language) => void = () => {};

export function onLanguageApplied(sync: (lang: Language) => void) {
  syncNative = sync;
}

function apply(lang: Language) {
  void i18n.changeLanguage(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  syncNative(lang);
}

/** Applique la langue enregistrée (ou celle du système), avant le premier rendu. */
export function applyInitialLanguage(): Language {
  const lang = resolveLanguage(readLanguageChoice(), systemLanguages());
  apply(lang);
  return lang;
}

/** Enregistre le choix et change la langue à chaud. */
export function setLanguage(choice: LanguageChoice) {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_KEY, choice);
  } catch {
    // Stockage indisponible : le choix vaut pour la session.
  }
  apply(resolveLanguage(choice, systemLanguages()));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  i18n.on("languageChanged", listener);
  return () => {
    listeners.delete(listener);
    i18n.off("languageChanged", listener);
  };
}

/** Choix enregistré et langue affichée, à jour à chaque changement. */
export function useLanguage(): {
  choice: LanguageChoice;
  language: Language;
  choose: (choice: LanguageChoice) => void;
} {
  const choice = useSyncExternalStore(subscribe, readLanguageChoice, () => "system" as const);
  const language = useSyncExternalStore(subscribe, currentLanguage, () => "en" as const);
  return { choice, language, choose: setLanguage };
}
