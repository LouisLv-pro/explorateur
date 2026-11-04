import type { ComponentProps } from "react";
import { preloadable } from "@/lib/preloadable";
import type { DataView } from "./data/DataView";
import { preloadHighlighter } from "./highlight";

// Vues lourdes chargées à la demande, et préchargées pendant un temps mort après le lancement :
// le premier fichier de chaque type s'affiche sans attendre son code.

// react-markdown et sa mise en page.
export const markdownView = preloadable(() => import("./markdown/MarkdownView"));
// Tableau et arbre des CSV, TSV, JSON et YAML (papaparse, yaml).
export const dataView = preloadable<ComponentProps<typeof DataView>>(() =>
  import("./data/DataView").then((m) => ({ default: m.DataView })),
);
// CodeMirror (éditeur de la source).
export const codeMirrorEditor = preloadable(() => import("@/features/editor/CodeMirrorEditor"));

/** Langages CodeMirror courants (noms de `@codemirror/language-data`). */
const EDITOR_LANGUAGES = ["Rust", "TypeScript", "TSX", "JavaScript", "JSON", "Markdown", "CSS"];
/** Langages Shiki des blocs de code Markdown les plus fréquents. */
const BLOCK_LANGUAGES = ["rust", "typescript", "tsx", "javascript", "json", "bash", "toml", "yaml"];

/** Exécute `fn` au prochain temps mort (WebKit n'a pas toujours `requestIdleCallback`). */
function whenIdle(fn: () => void) {
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 3000 });
  else setTimeout(fn, 500);
}

let preloadStarted = false;

/**
 * Précharge les vues et les langages, une étape par temps mort pour ne jamais bloquer une
 * image. Appelé une fois l'espace de travail affiché, pour ne pas ralentir le lancement ; les
 * appels suivants ne font rien. Mermaid (plusieurs Mo, rare) reste chargé à la demande.
 */
export function preloadViews() {
  if (preloadStarted) return;
  preloadStarted = true;
  const steps: (() => Promise<unknown>)[] = [
    codeMirrorEditor.preload,
    async () => {
      const [{ LanguageDescription }, { languages }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/language-data"),
      ]);
      for (const name of EDITOR_LANGUAGES) {
        await LanguageDescription.matchLanguageName(languages, name)?.load();
      }
    },
    markdownView.preload,
    () => preloadHighlighter(BLOCK_LANGUAGES),
    dataView.preload,
  ];
  const next = () => {
    const step = steps.shift();
    if (!step) return;
    whenIdle(() => {
      step()
        .catch(() => {
          // Préchargement manqué : la vue se chargera à la demande, comme avant.
        })
        .finally(next);
    });
  };
  next();
}
