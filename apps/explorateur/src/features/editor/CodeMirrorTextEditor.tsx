import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Annotation, Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, keymap, placeholder } from "@codemirror/view";
import { useTranslation } from "react-i18next";
import { editorPhrases, editorTheme, highlightStyle } from "./theme";

/** Transaction venue de la propriété `value` : ce n'est pas une saisie. */
const fromProp = Annotation.define<boolean>();

/** Langage de coloration, chargé à la demande. */
const language = new Compartment();
/** Lecture seule (création en cours). */
const readOnlyState = new Compartment();

/** Textes qui suivent la langue : phrases de CodeMirror, nom accessible et indication du champ. */
const texts = new Compartment();

function textsExtension(label: string, hint: string | undefined): Extension {
  return [
    EditorState.phrases.of(editorPhrases()),
    EditorView.contentAttributes.of({ "aria-label": label }),
    hint === undefined ? [] : placeholder(hint),
  ];
}

/** Sans numéros de ligne : un peu d'air autour du texte, par-dessus `editorTheme`. */
const fieldTheme = EditorView.theme({
  "&.cm-editor .cm-content": { padding: "8px 0" },
  "&.cm-editor .cm-line": { padding: "0 12px" },
  "&.cm-editor .cm-placeholder": { color: "var(--color-mute)" },
});

export type TextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Nom de fichier fictif, pour le choix du langage de coloration (`corps.md`). */
  fileName: string;
  /** Nom accessible de la zone de saisie. */
  label: string;
  placeholderText?: string;
  readOnly?: boolean;
  /** ⌘↵ : prend le pas sur « insérer une ligne » de CodeMirror. */
  onSubmit?: () => void;
};

/**
 * Éditeur CodeMirror 6 d'un texte contrôlé (corps d'une issue), chargé à la demande par
 * `TextEditor`. Même thème et mêmes couleurs de syntaxe que l'éditeur de fichiers, mais sans
 * document de session, gouttière git ni recherche.
 */
export default function CodeMirrorTextEditor({
  value,
  onChange,
  fileName,
  label,
  placeholderText,
  readOnly = false,
  onSubmit,
}: TextEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Les rappels changent à chaque rendu : la vue lit toujours les derniers.
  const callbacks = useRef({ onChange, onSubmit });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit };
  });

  // Création de la vue, une fois ; le texte initial est celui du premier rendu.
  const initial = useRef({ value, readOnly, label, placeholderText });
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const { value: doc, readOnly: locked, label: aria, placeholderText: hint } = initial.current;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          highlightSpecialChars(),
          history(),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  callbacks.current.onSubmit?.();
                  return callbacks.current.onSubmit !== undefined;
                },
              },
            ]),
          ),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          syntaxHighlighting(highlightStyle),
          language.of([]),
          readOnlyState.of([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
          EditorView.lineWrapping,
          editorTheme,
          fieldTheme,
          texts.of(textsExtension(aria, hint)),
          EditorView.updateListener.of((update) => {
            const typed = update.transactions.some(
              (tr) => tr.docChanged && !tr.annotation(fromProp),
            );
            if (typed) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Texte remplacé par le parent (modèle choisi, brouillon effacé).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: fromProp.of(true),
      });
    }
  }, [value]);

  // Le nom accessible et l'indication viennent du parent (déjà traduits) : ils suivent la langue
  // à chaque changement, ainsi que les phrases de CodeMirror.
  const lang = useTranslation().i18n.resolvedLanguage;
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: texts.reconfigure(textsExtension(label, placeholderText)),
    });
  }, [label, placeholderText, lang]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyState.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    const description = LanguageDescription.matchFilename(languages, fileName);
    if (!description) return;
    let cancelled = false;
    description
      .load()
      .then((support) => {
        if (!cancelled) viewRef.current?.dispatch({ effects: language.reconfigure(support) });
      })
      .catch(() => {
        // Langage introuvable : texte sans coloration.
      });
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return <div ref={parentRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden" />;
}
