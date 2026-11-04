import { useEffect, useMemo, useState } from "react";
import type { HighlighterCore, ThemedToken, ThemeRegistration } from "shiki/core";

export type Token = ThemedToken;

/** Au-delà, pas de coloration : texte brut numéroté (spec apercu.md). */
export const MAX_HIGHLIGHT_CHARS = 200_000;

const THEME = "explorateur";

/** Couleur d'un rôle de syntaxe de DESIGN.md (`--color-syntax-*` de `theme.css`). */
const role = (name: string) => `var(--color-syntax-${name})`;

/**
 * Portées TextMate → rôles de syntaxe (spec couleurs-syntaxe.md). La portée la plus précise
 * l'emporte : `keyword.operator` (opérateurs, couleur du texte) passe devant `keyword`.
 */
const TOKEN_COLORS: ThemeRegistration["tokenColors"] = [
  {
    scope: ["comment", "punctuation.definition.comment", "string.quoted.docstring"],
    settings: { foreground: role("comment"), fontStyle: "italic" },
  },
  {
    scope: ["string", "constant.character", "string.regexp", "markup.inline.raw"],
    settings: { foreground: role("string") },
  },
  {
    scope: [
      "constant.numeric",
      "constant.language",
      "constant.other",
      "keyword.other.unit",
      "support.constant",
    ],
    settings: { foreground: role("number") },
  },
  {
    scope: [
      "keyword",
      "storage.type",
      "storage.modifier",
      "variable.language",
      "keyword.operator.logical",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.operator.word",
    ],
    settings: { foreground: role("keyword") },
  },
  { scope: ["keyword.operator"], settings: { foreground: "var(--color-ink)" } },
  {
    scope: ["entity.name.function", "support.function", "variable.function"],
    settings: { foreground: role("function") },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "entity.name.namespace",
      "entity.other.inherited-class",
      "support.type",
      "support.class",
      "storage.type.primitive",
    ],
    settings: { foreground: role("type") },
  },
  {
    scope: [
      "variable.other.property",
      "variable.other.object.property",
      "support.type.property-name",
      "meta.object-literal.key",
      "entity.other.attribute-name",
      "entity.name.tag.yaml",
      "variable.other.key",
      "support.variable.property",
    ],
    settings: { foreground: role("property") },
  },
  {
    scope: ["entity.name.tag", "support.class.component"],
    settings: { foreground: role("tag") },
  },
  {
    scope: [
      "entity.name.function.macro",
      "support.macro",
      "meta.attribute.rust",
      "meta.decorator",
      "entity.name.function.decorator",
      "punctuation.decorator",
      "storage.type.annotation",
      "entity.name.function.preprocessor",
      "keyword.control.directive",
    ],
    settings: { foreground: role("macro") },
  },
  { scope: ["markup.heading", "markup.bold", "strong"], settings: { fontStyle: "bold" } },
  { scope: ["markup.italic", "emphasis"], settings: { fontStyle: "italic" } },
  {
    scope: ["markup.underline.link", "string.other.link"],
    settings: { foreground: "var(--color-link)", fontStyle: "underline" },
  },
  { scope: ["invalid"], settings: { foreground: "var(--color-error)" } },
];

let highlighterPromise: Promise<HighlighterCore> | null = null;
/** Highlighter une fois créé : de quoi colorer sans attendre un langage déjà chargé. */
let readyHighlighter: HighlighterCore | null = null;

/** Langage déjà chargé (nom ou alias, `ts` comme `typescript`). */
const isLoaded = (lang: string) => readyHighlighter?.getLoadedLanguages().includes(lang) ?? false;

/**
 * Un seul highlighter pour toute l'app, créé à la première demande. Moteur d'expressions
 * régulières en JavaScript : pas de WebAssembly, donc pas de `wasm-unsafe-eval` dans la CSP.
 * Thème à variables CSS : les couleurs suivent `theme.css`, donc le thème sombre, sans
 * recolorer (les jetons en cache restent valables).
 */
function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
    const base = createCssVariablesTheme({ name: THEME, variablePrefix: "--color-" });
    const theme: ThemeRegistration = {
      ...base,
      colors: {
        ...base.colors,
        "editor.foreground": "var(--color-ink)",
        "editor.background": "var(--color-canvas-soft)",
      },
      tokenColors: TOKEN_COLORS,
    };
    readyHighlighter = await createHighlighterCore({
      themes: [theme],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
    return readyHighlighter;
  })();
  return highlighterPromise;
}

/** Crée le highlighter et charge `langs` à l'avance (temps mort après le lancement). */
export async function preloadHighlighter(langs: string[]): Promise<void> {
  for (const lang of langs) await loadLanguage(lang);
}

/** Charge `lang` dans le highlighter ; faux si Shiki ne le connaît pas. */
async function loadLanguage(lang: string): Promise<boolean> {
  if (isLoaded(lang)) return true;
  const [highlighter, { bundledLanguages }] = await Promise.all([
    getHighlighter(),
    import("shiki/langs"),
  ]);
  const loader = (bundledLanguages as Record<string, (typeof bundledLanguages)["rust"]>)[lang];
  if (!loader) return false;
  await highlighter.loadLanguage(loader);
  return true;
}

function tokenize(highlighter: HighlighterCore, code: string, lang: string): Token[][] {
  const { tokens } = highlighter.codeToTokens(code, { lang, theme: THEME });
  cache.set(cacheKey(code, lang), tokens);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return tokens;
}

/**
 * Au-delà, un texte jamais coloré l'est après la première image, pas pendant le rendu : un gros
 * fichier ou un gros diff s'affiche d'abord en brut plutôt que de bloquer son affichage.
 */
const MAX_SYNC_HIGHLIGHT_CHARS = 20_000;

/**
 * Jetons sans attendre : en cache, ou texte court dont le langage est déjà chargé ; sinon
 * `null`.
 */
function highlightNow(code: string, lang: string): Token[][] | null {
  const hit = cache.get(cacheKey(code, lang));
  if (hit) return hit;
  if (code.length > MAX_SYNC_HIGHLIGHT_CHARS) return null;
  if (!readyHighlighter || !isLoaded(lang)) return null;
  return tokenize(readyHighlighter, code, lang);
}

// Derniers résultats : revenir à un fichier déjà coloré ne relance pas la coloration.
const CACHE_SIZE = 16;
const cache = new Map<string, Token[][]>();
const cacheKey = (code: string, lang: string) => `${lang}\u0000${code}`;

/** Colore `code`, ou `null` si le langage est inconnu de Shiki. */
export async function highlight(code: string, lang: string): Promise<Token[][] | null> {
  const hit = cache.get(cacheKey(code, lang));
  if (hit) return hit;
  if (!(await loadLanguage(lang))) return null;
  return tokenize(await getHighlighter(), code, lang);
}

/**
 * Lignes de jetons colorés pour `code`, ou `null` tant que la coloration n'est pas prête
 * (ou impossible : langage inconnu, texte trop long). L'appelant affiche alors le texte brut.
 */
export function useHighlighted(code: string, lang: string | null): Token[][] | null {
  const [done, setDone] = useState<{ code: string; lang: string; tokens: Token[][] } | null>(null);
  const enabled = lang !== null && code.length <= MAX_HIGHLIGHT_CHARS;
  // Déjà coloré ou langage chargé : les jetons arrivent avec le premier rendu, sans image
  // de texte brut.
  const now = useMemo(
    () => (enabled && lang !== null ? highlightNow(code, lang) : null),
    [code, lang, enabled],
  );

  useEffect(() => {
    if (!enabled || lang === null || now) return;
    let cancelled = false;
    highlight(code, lang)
      .then((tokens) => {
        if (!cancelled && tokens) setDone({ code, lang, tokens });
      })
      .catch(() => {
        // Coloration impossible : le texte brut reste affiché.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, enabled, now]);

  if (now) return now;
  return enabled && done?.code === code && done.lang === lang ? done.tokens : null;
}
