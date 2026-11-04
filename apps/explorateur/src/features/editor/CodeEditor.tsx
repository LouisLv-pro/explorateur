import { Suspense } from "react";
import { codeMirrorEditor } from "@/features/preview/views";
import { getDocument } from "./documents";

// CodeMirror et ses langages : chargés au premier fichier texte affiché, ou préchargés.
const CodeMirrorEditor = codeMirrorEditor.Component;

type Props = {
  /** Clé du document de l'éditeur (`tabKey`), qui doit déjà exister (`loadDocument`). */
  docKey: string;
  path: string;
  name: string;
  /** Ligne à montrer (à partir de 1) : ligne centrée puis surlignée 2 s. */
  line?: number;
  /** Change à chaque demande : re-déclenche l'aller à la ligne, même sur la même ligne. */
  lineSeq?: number;
};

/** Éditeur de la source d'un fichier texte, Markdown ou HTML (spec editeur.md). */
export function CodeEditor(props: Props) {
  return (
    <Suspense fallback={<PlainText text={getDocument(props.docKey)?.text ?? ""} />}>
      <CodeMirrorEditor {...props} />
    </Suspense>
  );
}

/** Texte brut le temps du chargement de CodeMirror, à la même place et dans la même police. */
function PlainText({ text }: { text: string }) {
  return (
    <pre className="min-h-0 min-w-0 flex-1 overflow-hidden py-3 pr-4 pl-14 font-mono text-code text-ink">
      {text}
    </pre>
  );
}
