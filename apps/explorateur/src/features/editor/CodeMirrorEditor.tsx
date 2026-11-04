import { useEffect, useLayoutEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import {
  editDocument,
  getDocument,
  keepEditorState,
  markLineShown,
  takeEditorFocus,
  useDocument,
} from "./documents";
import { useTranslation } from "react-i18next";
import { colorSwatches } from "@/features/colors/editorSwatches";
import { useIndexText } from "@/features/git/api";
import { useGitMarksContext } from "@/features/git/context";
import { useWorkspace } from "@/features/workspace/context";
import i18n from "@/i18n";
import { gitGutter, indexTextOf, setIndexText } from "./gitGutter";
import { useGoToLineCommand } from "./goToLine";
import { languageFor } from "@/features/preview/languages";
import { editorPhrases, editorTheme, highlightStyle } from "./theme";

const FLASH_MS = 2000;

/** Transaction venue du disque (relecture) : ce n'est pas une saisie. */
const fromDisk = Annotation.define<boolean>();

/** Langage de coloration, chargé à la demande d'après le nom du fichier. */
const language = new Compartment();

/** Textes de la langue active : phrases de CodeMirror et nom accessible de la zone de saisie. */
const locale = new Compartment();

function localeExtension(): Extension {
  return [
    EditorState.phrases.of(editorPhrases()),
    EditorView.contentAttributes.of({ "aria-label": i18n.t("editor:label") }),
  ];
}

/** Surlignage d'une ligne (aller à la ligne) : position de son début, ou `null`. */
const flash = StateEffect.define<number | null>();
const flashLine = Decoration.line({ class: "cm-flash-line" });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(flash)) {
        next =
          effect.value === null ? Decoration.none : Decoration.set([flashLine.range(effect.value)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Raccourcis de recherche, sans `Mod-Shift-l` (« sélectionner les occurrences ») : ⇧⌘L change le
 * thème de l'app, aussi depuis l'éditeur (docs/specs/raccourcis.md).
 */
const SEARCH_KEYMAP = searchKeymap.filter((binding) => binding.key !== "Mod-Shift-l");

/** Langage du fichier : par le nom (extensions de `language-data`), sinon par la table de l'aperçu (`Cargo.lock`…). */
function describeLanguage(name: string): LanguageDescription | null {
  const fallback = languageFor(name);
  return (
    LanguageDescription.matchFilename(languages, name) ??
    (fallback ? LanguageDescription.matchLanguageName(languages, fallback) : null)
  );
}

function createState(docKey: string, text: string, name: string): EditorState {
  // Langage déjà chargé (préchargé, ou fichier du même type) : coloré dès la première image.
  const support = describeLanguage(name)?.support;
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      gitGutter,
      highlightSpecialChars(),
      history(),
      search({ top: true }),
      keymap.of([...SEARCH_KEYMAP, ...historyKeymap, ...defaultKeymap]),
      syntaxHighlighting(highlightStyle),
      language.of(support ?? []),
      editorTheme,
      flashField,
      colorSwatches,
      locale.of(localeExtension()),
      EditorView.updateListener.of((update) => {
        keepEditorState(docKey, { editorState: update.state });
        const typed = update.transactions.some((tr) => tr.docChanged && !tr.annotation(fromDisk));
        if (typed) editDocument(docKey, update.state.doc.toString());
      }),
    ],
  });
}

/** Remplace le texte (relecture du disque) en gardant le curseur dans la limite du texte. */
function replaceText(view: EditorView, text: string) {
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(head),
    annotations: fromDisk.of(true),
  });
}

/**
 * Éditeur CodeMirror 6 d'un document (`documents.ts`), chargé à la demande par `CodeEditor`.
 * Masqué (`<Activity>`) ou démonté (changement de mode), il garde son état dans le document :
 * historique, curseur et défilement reviennent au réaffichage.
 */
export default function CodeMirrorEditor({
  docKey,
  path,
  name,
  line,
  lineSeq,
}: {
  docKey: string;
  path: string;
  /** Nom du fichier : choix du langage de coloration. */
  name: string;
  line?: number;
  lineSeq?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const version = useDocument(docKey)?.version;
  const { root } = useWorkspace();
  const { inRepo } = useGitMarksContext();
  const indexText = useIndexText(root?.path ?? null, path, inRepo);
  useGoToLineCommand(viewRef);
  const lang = useTranslation().i18n.resolvedLanguage;

  // Création de la vue, à partir de l'état gardé s'il existe. Avant la peinture : pas
  // d'image avec un volet vide entre le texte brut de l'attente et l'éditeur.
  useLayoutEffect(() => {
    const parent = parentRef.current;
    const doc = getDocument(docKey);
    if (!parent || !doc) return;
    const kept = doc.editorState instanceof EditorState ? doc.editorState : null;
    const view = new EditorView({ state: kept ?? createState(docKey, doc.text, name), parent });
    viewRef.current = view;
    // Un surlignage interrompu par le masquage ne revient pas.
    view.dispatch({ effects: flash.of(null) });
    if (view.state.doc.toString() !== doc.text) replaceText(view, doc.text);
    else if (doc.scroll instanceof StateEffect) view.dispatch({ effects: doc.scroll });
    if (takeEditorFocus(path)) view.focus();

    const onScroll = () => keepEditorState(docKey, { scroll: view.scrollSnapshot() });
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      keepEditorState(docKey, { editorState: view.state });
      view.destroy();
      viewRef.current = null;
    };
    // `path` ne sert qu'à la demande de focus au montage, `name` qu'au langage de départ
    // (l'effet suivant suit un renommage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Textes de CodeMirror dans la langue active : au changement de langue, et à chaque création de
  // la vue (l'état gardé du document garde les textes de la langue où il a été créé).
  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: locale.reconfigure(localeExtension()) });
    // `lang` ne sert qu'à relancer l'effet : `localeExtension` lit la langue active.
  }, [docKey, lang]);

  // Langage d'après le nom (suit un renommage). Déjà chargé : appliqué avant la peinture.
  useLayoutEffect(() => {
    const description = describeLanguage(name);
    const view = viewRef.current;
    if (!view) return;
    const apply = (support: Extension) => {
      if (language.get(view.state) !== support) {
        view.dispatch({ effects: language.reconfigure(support) });
      }
    };
    if (!description) {
      apply([]);
      return;
    }
    if (description.support) {
      apply(description.support);
      return;
    }
    let cancelled = false;
    description
      .load()
      .then((support) => {
        if (!cancelled) apply(support);
      })
      .catch(() => {
        // Langage introuvable : texte sans coloration.
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  // Gouttière git : texte indexé lu à l'ouverture, relu après un changement disque ou un geste
  // git (clés sous le statut), et donné à l'état CodeMirror s'il a changé.
  useEffect(() => {
    const view = viewRef.current;
    if (view && indexTextOf(view) !== indexText) {
      view.dispatch({ effects: setIndexText.of(indexText) });
    }
  }, [docKey, indexText]);

  // Texte remplacé hors de l'éditeur (relecture du disque, « Recharger »).
  useEffect(() => {
    const view = viewRef.current;
    const doc = getDocument(docKey);
    if (view && doc && view.state.doc.toString() !== doc.text) replaceText(view, doc.text);
  }, [docKey, version]);

  // Aller à la ligne : ligne centrée et surlignée 2 s, une fois par demande (`lineSeq`).
  useEffect(() => {
    const view = viewRef.current;
    const doc = getDocument(docKey);
    if (!view || !doc || line === undefined || doc.lineSeq === lineSeq) return;
    // Noté après le montage (micro-tâche) : en dev, `StrictMode` rejoue l'effet sur une vue
    // recréée, qui doit aussi aller à la ligne.
    queueMicrotask(() => markLineShown(docKey, lineSeq));
    const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: target.from },
      effects: [EditorView.scrollIntoView(target.from, { y: "center" }), flash.of(target.from)],
    });
    const timer = setTimeout(() => view.dispatch({ effects: flash.of(null) }), FLASH_MS);
    return () => clearTimeout(timer);
  }, [docKey, line, lineSeq]);

  return <div ref={parentRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden" />;
}
