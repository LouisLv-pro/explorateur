import { lazy, Suspense } from "react";
import type { TextEditorProps } from "./CodeMirrorTextEditor";

// CodeMirror n'est chargé qu'au premier affichage (déjà là si un fichier texte a été ouvert).
const CodeMirrorTextEditor = lazy(() => import("./CodeMirrorTextEditor"));

/**
 * Éditeur d'un texte contrôlé hors fichier (corps d'une nouvelle issue, langage Markdown) :
 * `CodeEditor` est lié à un document de session d'onglet, celui-ci prend et rend une chaîne.
 */
export function TextEditor(props: TextEditorProps) {
  return (
    <Suspense
      fallback={
        <pre className="min-h-0 min-w-0 flex-1 overflow-hidden px-3 py-2 font-mono text-code whitespace-pre-wrap text-ink">
          {props.value}
        </pre>
      }
    >
      <CodeMirrorTextEditor {...props} />
    </Suspense>
  );
}
