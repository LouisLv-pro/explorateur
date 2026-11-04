import { useSyncExternalStore } from "react";
import { commands, type AppError, type FilePreview } from "@/bindings";
import { detectLineBreak, normalizeLineBreaks, withLineBreak, type LineBreak } from "./lineBreak";
import { selectedLines, type SelectedLines } from "./selection";

/**
 * Documents de l'éditeur, un par onglet (clé `tabKey`). Ce n'est pas un cache des données de
 * Rust (TanStack Query lit toujours le fichier) : c'est la session d'édition, qui doit survivre
 * au masquage d'un onglet (`<Activity>` détruit les effets) et s'enregistrer depuis une boîte
 * de fermeture alors que son volet est masqué.
 */

/** Bannière dans l'onglet (spec editeur.md). */
export type Banner =
  /** Le fichier a changé sur le disque alors que l'éditeur a des modifications. */
  | { kind: "conflict" }
  /** Le fichier a été supprimé alors que l'éditeur a des modifications. */
  | { kind: "deleted" }
  /** Échec d'un enregistrement (écriture refusée, dossier disparu…). */
  | { kind: "error"; reason: SaveFailure };

/** Cause d'un enregistrement échoué : le texte est choisi au rendu (`EditorBanner`). */
export type SaveFailure = "denied" | "folderMissing" | "failed";

export type EditorDoc = {
  /** Dernier texte lu ou enregistré, fins de ligne en `\n`. */
  saved: string;
  /** Révision du fichier qui correspond à `saved`. */
  revision: string;
  lineBreak: LineBreak;
  /** Texte de l'éditeur, en `\n`. */
  text: string;
  banner: Banner | null;
  /** Change quand le texte est remplacé hors de l'éditeur (relecture) : l'éditeur l'applique. */
  version: number;
  /**
   * Heure (ms) de la dernière lecture ou écriture appliquée. Une lecture plus ancienne (cache de
   * TanStack Query d'avant un enregistrement, effet rejoué au réaffichage) est ignorée.
   */
  stamp: number;
  /** Dernier `lineSeq` montré : revenir sur l'onglet ne refait pas l'aller à la ligne. */
  lineSeq?: number;
  /** État de CodeMirror (historique, curseur), gardé quand l'éditeur est démonté. */
  editorState?: unknown;
  /** Position de défilement de CodeMirror (`scrollSnapshot`), même raison. */
  scroll?: unknown;
};

const docs = new Map<string, EditorDoc>();
const listeners = new Set<() => void>();
/** Chemins dont l'éditeur doit prendre le focus à son montage (fichier créé). */
const focusRequests = new Set<string>();

function notify() {
  for (const listener of listeners) listener();
}

function update(key: string, patch: Partial<EditorDoc>) {
  const doc = docs.get(key);
  if (!doc) return;
  docs.set(key, { ...doc, ...patch });
  notify();
}

export function subscribeDocuments(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDocument(key: string): EditorDoc | undefined {
  return docs.get(key);
}

export function isDirty(doc: EditorDoc | undefined): boolean {
  return doc !== undefined && doc.text !== doc.saved;
}

/** Document de l'onglet `key`, relu à chaque changement. */
export function useDocument(key: string): EditorDoc | undefined {
  return useSyncExternalStore(subscribeDocuments, () => docs.get(key));
}

type TextPreview = FilePreview & {
  content: { kind: "Text" | "Markdown" | "Html" | "Mermaid"; text: string };
};

/** Vrai si l'aperçu porte un texte éditable. */
export function isTextPreview(preview: FilePreview): preview is TextPreview {
  const { kind } = preview.content;
  return kind === "Text" || kind === "Markdown" || kind === "Html" || kind === "Mermaid";
}

/**
 * Applique une lecture du fichier (ouverture ou changement disque). Sans modifications, le
 * texte relu remplace celui de l'éditeur ; avec modifications, rien n'est remplacé et la
 * bannière de conflit s'affiche. Même révision : rien ne bouge (notre propre enregistrement).
 */
export function loadDocument(key: string, preview: TextPreview, stamp: number) {
  const read = preview.content.text;
  const text = normalizeLineBreaks(read);
  const doc = docs.get(key);
  if (!doc) {
    docs.set(key, {
      saved: text,
      revision: preview.revision,
      lineBreak: detectLineBreak(read),
      text,
      banner: null,
      version: 0,
      stamp,
    });
    notify();
    return;
  }
  if (stamp <= doc.stamp) return;
  if (doc.revision === preview.revision && doc.banner?.kind !== "deleted") {
    docs.set(key, { ...doc, stamp });
    return;
  }
  if (!isDirty(doc) || doc.text === text) {
    // Texte identique : seule la révision change, l'éditeur ne bouge pas.
    const replaced = doc.text !== text;
    update(key, {
      saved: text,
      revision: preview.revision,
      lineBreak: detectLineBreak(read),
      text,
      banner: null,
      version: replaced ? doc.version + 1 : doc.version,
      stamp,
    });
    return;
  }
  update(key, { banner: { kind: "conflict" }, stamp });
}

/** Le fichier n'existe plus : bannière seulement si l'éditeur a des modifications. */
export function markDeleted(key: string) {
  const doc = docs.get(key);
  if (isDirty(doc) && doc?.banner?.kind !== "deleted") update(key, { banner: { kind: "deleted" } });
}

/** Saisie dans l'éditeur. */
export function editDocument(key: string, text: string) {
  const doc = docs.get(key);
  if (doc && doc.text !== text) update(key, { text });
}

/** Garde l'état de CodeMirror sans prévenir personne (rien à redessiner). */
export function keepEditorState(key: string, patch: Pick<EditorDoc, "editorState" | "scroll">) {
  const doc = docs.get(key);
  if (doc) docs.set(key, { ...doc, ...patch });
}

/** Onglets dont la source est affichée dans l'éditeur (fichier texte, Markdown ou HTML en source). */
const sourceShown = new Set<string>();

/** `FilePane` signale si la source du fichier est affichée (mode Source ou Scindé, fichier texte). */
export function setSourceShown(key: string, shown: boolean) {
  if (shown) sourceShown.add(key);
  else sourceShown.delete(key);
}

/**
 * Lignes sélectionnées dans l'éditeur de `key` (ligne du curseur sans sélection), `null` si la
 * source du fichier n'est pas affichée dans l'éditeur. Lit l'état gardé de CodeMirror : sans
 * lui (éditeur monté, curseur jamais bougé), le curseur est au début du fichier.
 */
export function getSelectedLines(key: string): SelectedLines | null {
  const doc = docs.get(key);
  if (!doc || !sourceShown.has(key)) return null;
  const selection = (doc.editorState as { selection?: { main?: { from: number; to: number } } })
    ?.selection?.main;
  return selectedLines(doc.text, selection?.from ?? 0, selection?.to ?? 0);
}

export function markLineShown(key: string, lineSeq: number | undefined) {
  const doc = docs.get(key);
  if (doc) docs.set(key, { ...doc, lineSeq });
}

export function closeBanner(key: string) {
  update(key, { banner: null });
}

/** Oublie les documents des onglets fermés. */
export function pruneDocuments(keys: Set<string>) {
  for (const key of docs.keys()) {
    if (keys.has(key)) continue;
    docs.delete(key);
    sourceShown.delete(key);
  }
}

export function requestEditorFocus(path: string) {
  focusRequests.add(path);
}

/**
 * Vrai si l'éditeur de `path` doit prendre le focus. La demande est oubliée juste après le
 * montage (micro-tâche) : en dev, `StrictMode` monte, démonte et remonte l'éditeur d'affilée,
 * et seul le second montage reste.
 */
export function takeEditorFocus(path: string): boolean {
  if (!focusRequests.has(path)) return false;
  queueMicrotask(() => focusRequests.delete(path));
  return true;
}

function saveFailure(error: AppError): SaveFailure {
  switch (error.kind) {
    case "PermissionDenied":
      return "denied";
    case "NotFound":
      return "folderMissing";
    default:
      return "failed";
  }
}

/**
 * Enregistre le document `key` dans `path` s'il a des modifications ; vrai si le fichier est
 * à jour. `Conflict` affiche la bannière de conflit ; les modifications restent.
 */
export async function saveDocument(key: string, path: string): Promise<boolean> {
  const doc = docs.get(key);
  if (!doc) return true;
  if (!isDirty(doc)) return true;
  const text = doc.text;
  const result = await commands.saveFile(path, withLineBreak(text, doc.lineBreak), doc.revision);
  if (result.status === "error") {
    update(key, {
      banner:
        result.error.kind === "Conflict"
          ? { kind: "conflict" }
          : { kind: "error", reason: saveFailure(result.error) },
    });
    return false;
  }
  // `saved` est le texte envoyé : une frappe pendant l'écriture reste une modification.
  update(key, { saved: text, revision: result.data, banner: null, stamp: Date.now() });
  // Mon propre enregistrement est une lecture (spec derniere-lecture.md) : ni pastille, ni
  // bandeau qui me montrerait mes propres modifications.
  void commands.markRead(path);
  return true;
}

/** Relit le fichier pour la bannière de conflit ; `null` si la lecture échoue. */
async function readText(path: string): Promise<TextPreview | null> {
  const result = await commands.openFile(path);
  return result.status === "ok" && isTextPreview(result.data) ? result.data : null;
}

/** « Recharger » : le texte du disque remplace les modifications. */
export async function reloadDocument(key: string, path: string) {
  const preview = await readText(path);
  const doc = docs.get(key);
  if (!preview || !doc) return;
  const read = preview.content.text;
  const text = normalizeLineBreaks(read);
  update(key, {
    saved: text,
    revision: preview.revision,
    lineBreak: detectLineBreak(read),
    text,
    banner: null,
    version: doc.version + 1,
    stamp: Date.now(),
  });
}

/** « Garder mes modifications » : la bannière se ferme, le prochain ⌘S écrase le disque. */
export async function keepChanges(key: string, path: string) {
  const preview = await readText(path);
  if (!preview) {
    closeBanner(key);
    return;
  }
  update(key, {
    saved: normalizeLineBreaks(preview.content.text),
    revision: preview.revision,
    banner: null,
    stamp: Date.now(),
  });
}
