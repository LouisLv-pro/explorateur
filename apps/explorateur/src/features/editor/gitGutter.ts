// Gouttière git de l'éditeur (docs/specs/git.md, lot 3) : barres verte (ajout) et bleue
// (modification), triangle rouge (suppression), par rapport au texte indexé. Blocs calculés en
// Rust (`get_git_gutter_blocks`) 150 ms après la dernière frappe. Clic sur une barre : bloc
// d'origine affiché sous ses lignes, avec « Annuler ce bloc » (transaction ordinaire : ni
// enregistrement ni confirmation, ⌘Z la défait) et ×. Échap le ferme.
import { Prec, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { GutterBlock } from "@/bindings";
import { fetchGutterBlocks } from "@/features/git/api";
import i18n from "@/i18n";
import { revertBlock } from "@/features/git/marks";

const DEBOUNCE_MS = 150;

type GutterState = {
  /** Texte indexé (fins de ligne `\n`) ; `null` : pas de gouttière (non suivi, hors dépôt). */
  indexText: string | null;
  blocks: readonly GutterBlock[];
  /** Marques de la gouttière, suivies à la frappe en attendant le prochain calcul. */
  markers: RangeSet<GutterMarker>;
  /** Bloc affiché en ligne (indice dans `blocks`), ou `null`. */
  open: number | null;
};

/** Nouveau texte indexé (lu par `CodeMirrorEditor`). */
export const setIndexText = StateEffect.define<string | null>();
const setBlocks = StateEffect.define<readonly GutterBlock[]>();
const openBlock = StateEffect.define<number | null>();

class Mark extends GutterMarker {
  constructor(readonly kind: string) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof Mark && other.kind === this.kind;
  }
  override toDOM(): Node {
    const element = document.createElement("div");
    element.className = `cm-git-mark cm-git-${this.kind}`;
    return element;
  }
}

const MARKS = {
  added: new Mark("added"),
  modified: new Mark("modified"),
  /** Lignes supprimées après cette ligne (triangle en bas). */
  deleted: new Mark("deleted"),
  /** Lignes supprimées en tête du fichier (triangle en haut de la ligne 1). */
  deletedTop: new Mark("deleted-top"),
};

/** Ligne de la gouttière où se clique un bloc : la première, ou la ligne d'une suppression. */
function anchorLine(block: GutterBlock): number {
  return block.kind === "deleted" ? Math.max(block.startLine, 1) : block.startLine;
}

function buildMarkers(
  blocks: readonly GutterBlock[],
  lines: number,
  lineStart: (n: number) => number,
) {
  const ranges = [];
  for (const block of blocks) {
    if (block.kind === "deleted") {
      const line = anchorLine(block);
      if (line <= lines) {
        const mark = block.startLine === 0 ? MARKS.deletedTop : MARKS.deleted;
        ranges.push(mark.range(lineStart(line)));
      }
      continue;
    }
    const mark = block.kind === "added" ? MARKS.added : MARKS.modified;
    for (let n = block.startLine; n <= Math.min(block.endLine, lines); n += 1) {
      ranges.push(mark.range(lineStart(n)));
    }
  }
  return RangeSet.of(ranges, true);
}

const gutterField = StateField.define<GutterState>({
  create: () => ({ indexText: null, blocks: [], markers: RangeSet.empty, open: null }),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      // Le bloc ouvert ne correspond plus au texte : fermé.
      next = { ...next, markers: next.markers.map(tr.changes), open: null };
    }
    for (const effect of tr.effects) {
      if (effect.is(setIndexText)) {
        next =
          effect.value === null
            ? { indexText: null, blocks: [], markers: RangeSet.empty, open: null }
            : { ...next, indexText: effect.value, open: null };
      } else if (effect.is(setBlocks)) {
        const doc = tr.state.doc;
        next = {
          ...next,
          blocks: effect.value,
          markers: buildMarkers(effect.value, doc.lines, (n) => doc.line(n).from),
          open: null,
        };
      } else if (effect.is(openBlock)) {
        next = { ...next, open: effect.value };
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state): DecorationSet => {
      const { blocks, open } = state.field(field);
      const block = open === null ? undefined : blocks[open];
      if (!block) return Decoration.none;
      const doc = state.doc;
      const after = block.kind === "deleted" ? block.startLine : block.endLine;
      if (after > doc.lines) return Decoration.none;
      const widget = Decoration.widget({
        widget: new BlockWidget(block),
        block: true,
        side: after === 0 ? -1 : 1,
      });
      return Decoration.set([widget.range(after === 0 ? 0 : doc.line(after).to)]);
    }),
});

/** Bloc d'origine sous ses lignes : texte indexé, « Annuler ce bloc » et ×. */
class BlockWidget extends WidgetType {
  constructor(readonly block: GutterBlock) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof BlockWidget && other.block === this.block;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-git-block";
    box.setAttribute("role", "group");
    // Texte de la langue au moment où le bloc s'ouvre (rouvrir le bloc le met à jour).
    box.setAttribute("aria-label", i18n.t("editor:gitBlock.label"));
    if (this.block.original === "") {
      const note = document.createElement("p");
      note.className = "cm-git-block-note";
      note.textContent = i18n.t("editor:gitBlock.absent");
      box.append(note);
    } else {
      const pre = document.createElement("pre");
      pre.className = "cm-git-block-text";
      // Texte brut (jamais du HTML) ; la fin de ligne finale ne donne pas de ligne vide.
      pre.textContent = this.block.original.replace(/\n$/, "");
      box.append(pre);
    }
    const actions = document.createElement("div");
    actions.className = "cm-git-block-actions";
    const revert = document.createElement("button");
    revert.type = "button";
    revert.className = "cm-button";
    revert.textContent = i18n.t("editor:gitBlock.revert");
    revert.addEventListener("click", () => {
      view.dispatch({
        changes: revertBlock(view.state.doc.toString(), this.block),
        effects: openBlock.of(null),
        userEvent: "input.git-revert",
      });
      view.focus();
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-button cm-git-block-close";
    close.setAttribute("aria-label", i18n.t("common:close"));
    close.title = i18n.t("editor:gitBlock.closeTitle");
    close.textContent = "×";
    close.addEventListener("click", () => {
      view.dispatch({ effects: openBlock.of(null) });
      view.focus();
    });
    actions.append(revert, close);
    box.append(actions);
    return box;
  }
}

/** Recalcule les blocs après la frappe (ou tout de suite à un nouveau texte indexé). */
const recompute = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    destroyed = false;

    constructor(readonly view: EditorView) {
      if (view.state.field(gutterField).indexText !== null) this.schedule(0);
    }

    update(update: ViewUpdate) {
      const before = update.startState.field(gutterField).indexText;
      const after = update.state.field(gutterField).indexText;
      if (before !== after) this.schedule(0);
      else if (update.docChanged && after !== null) this.schedule(DEBOUNCE_MS);
    }

    schedule(delay: number) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.run();
      }, delay);
    }

    run() {
      const { indexText } = this.view.state.field(gutterField);
      if (indexText === null) return;
      const doc = this.view.state.doc;
      fetchGutterBlocks(indexText, doc.toString())
        .then((blocks) => {
          // Réponse périmée (frappe ou texte indexé plus récents) : un autre calcul suit.
          const state = this.view.state;
          if (this.destroyed || state.doc !== doc) return;
          if (state.field(gutterField).indexText !== indexText) return;
          this.view.dispatch({ effects: setBlocks.of(blocks) });
        })
        .catch(() => {
          // Calcul impossible : la gouttière garde ses marques.
        });
    }

    destroy() {
      this.destroyed = true;
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

const gitGutterMarks = gutter({
  class: "cm-git-gutter",
  markers: (view) => view.state.field(gutterField).markers,
  domEventHandlers: {
    mousedown(view, line) {
      const { blocks, open } = view.state.field(gutterField);
      const number = view.state.doc.lineAt(line.from).number;
      const index = blocks.findIndex((block) =>
        block.kind === "deleted"
          ? anchorLine(block) === number
          : block.startLine <= number && number <= block.endLine,
      );
      if (index < 0) return false;
      view.dispatch({ effects: openBlock.of(open === index ? null : index) });
      return true;
    },
  },
});

/** Échap ferme le bloc affiché (sinon laissé aux autres : recherche, app). */
const closeOnEscape = Prec.highest(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (view.state.field(gutterField).open === null) return false;
        view.dispatch({ effects: openBlock.of(null) });
        return true;
      },
    },
  ]),
);

/** Texte indexé connu de l'état (pour ne pas le renvoyer identique). */
export function indexTextOf(view: EditorView): string | null | undefined {
  return view.state.field(gutterField, false)?.indexText;
}

export const gitGutter: Extension = [gutterField, recompute, gitGutterMarks, closeOnEscape];
