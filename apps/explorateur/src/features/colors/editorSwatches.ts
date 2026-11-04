import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { findColors } from "./findColors";
import { SWATCH_CLASS } from "./swatch";

/** Pastille décorative, sans longueur dans le document : le curseur la saute. */
class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }

  eq(other: SwatchWidget): boolean {
    return other.color === this.color;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = SWATCH_CLASS;
    span.setAttribute("aria-hidden", "true");
    span.dataset.colorSwatch = "";
    span.style.backgroundColor = this.color;
    return span;
  }
}

/** Pastilles des couleurs du texte visible seulement (fichiers longs : reste rapide). */
function swatches(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (const { start, value } of findColors(view.state.doc.sliceString(from, to))) {
      builder.add(
        from + start,
        from + start,
        Decoration.widget({ widget: new SwatchWidget(value), side: 1 }),
      );
    }
  }
  return builder.finish();
}

/**
 * Extension CodeMirror (spec pastilles-couleur.md) : une pastille devant chaque couleur CSS,
 * recalculée à la frappe et au défilement. Le texte du document n'est pas modifié.
 */
export const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = swatches(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = swatches(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
