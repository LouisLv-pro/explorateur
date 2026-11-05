// Éditeur CodeMirror d'une cellule : même thème et mêmes couleurs que l'éditeur de fichiers, à
// la hauteur de son texte. Les touches de la cellule (⇧Entrée, ⌘Entrée, Échap) sont lues par la
// cellule avant CodeMirror (`onKeyDownCapture` de `NotebookView`).
import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, keymap } from "@codemirror/view";
import { useTranslation } from "react-i18next";
import { editorPhrases, editorTheme, highlightStyle } from "@/features/editor/theme";

/** Transaction venue de la propriété `value` : ce n'est pas une saisie. */
const fromProp = Annotation.define<boolean>();
const language = new Compartment();
const texts = new Compartment();

function textsExtension(label: string): Extension {
  return [
    EditorState.phrases.of(editorPhrases()),
    EditorView.contentAttributes.of({ "aria-label": label }),
  ];
}

/** Par-dessus `editorTheme` : hauteur du texte, fond de cellule, un peu d'air. */
const cellTheme = EditorView.theme({
  "&": { height: "auto", flex: "1 1 auto", backgroundColor: "var(--color-canvas-soft)" },
  "&.cm-editor .cm-content": { padding: "8px 0" },
  "&.cm-editor .cm-line": { padding: "0 12px" },
});

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Nom accessible de la zone de saisie. */
  label: string;
  /** Nom de langage de `@codemirror/language-data` (« Python », « Markdown ») ; aucun : texte brut. */
  languageName?: string;
  /** Lignes repliées à la largeur (Markdown, brut) ; le code défile en largeur. */
  wrap?: boolean;
  /** Prend le focus à chaque nouvelle valeur non nulle (cellule devenue active au clavier). */
  focusSeq?: number;
  /** Prend le focus dès sa création (Markdown ouvert par double-clic ou Entrée). */
  autoFocus?: boolean;
  onBlur?: () => void;
};

export function CellEditor({
  value,
  onChange,
  label,
  languageName,
  wrap = false,
  focusSeq,
  autoFocus = false,
  onBlur,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onBlur });
  useEffect(() => {
    callbacks.current = { onChange, onBlur };
  });

  // Création de la vue, une fois ; le texte initial est celui du premier rendu.
  const initial = useRef({ value, label, wrap, autoFocus });
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const { value: doc, label: aria, wrap: wrapped, autoFocus: focused } = initial.current;
    // Une vue détruite alors qu'elle a le focus émet `blur` : ce n'est pas l'utilisateur qui
    // quitte la cellule. En StrictMode, React détruit puis recrée la vue au montage, et ce faux
    // `blur` refermait l'éditeur Markdown à peine ouvert.
    let destroying = false;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          highlightSpecialChars(),
          history(),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          syntaxHighlighting(highlightStyle),
          language.of([]),
          wrapped ? EditorView.lineWrapping : [],
          editorTheme,
          cellTheme,
          texts.of(textsExtension(aria)),
          EditorView.domEventHandlers({
            blur: () => {
              if (!destroying) callbacks.current.onBlur?.();
            },
          }),
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
    if (focused) view.focus();
    return () => {
      destroying = true;
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Texte remplacé de l'extérieur (rechargement du fichier, changement de type).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: fromProp.of(true),
      });
    }
  }, [value]);

  const lang = useTranslation().i18n.resolvedLanguage;
  useEffect(() => {
    viewRef.current?.dispatch({ effects: texts.reconfigure(textsExtension(label)) });
  }, [label, lang]);

  useEffect(() => {
    if (focusSeq) viewRef.current?.focus();
  }, [focusSeq]);

  useEffect(() => {
    const description =
      languageName === undefined
        ? null
        : LanguageDescription.matchLanguageName(languages, languageName);
    if (!description) {
      viewRef.current?.dispatch({ effects: language.reconfigure([]) });
      return;
    }
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
  }, [languageName]);

  return (
    <div
      ref={parentRef}
      className="flex min-w-0 flex-1 overflow-hidden rounded-sm border border-hairline"
    />
  );
}
