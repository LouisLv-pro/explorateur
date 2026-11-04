import { useMemo, useRef, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { collapseAll, expandAll, flattenTree, toggle, type TreeRow } from "./tree";

/** Hauteur d'une ligne en px : fixe, donc sans mesure par ligne. */
const ROW_HEIGHT = 28;
/** Retrait par niveau, en px (la puce du chevron fait 20 px). */
const INDENT = 16;

const VALUE_CLASS: Record<TreeRow["type"], string> = {
  string: "data-string",
  number: "data-number",
  boolean: "data-number",
  null: "data-number",
  object: "text-mute",
  array: "text-mute",
};

/**
 * Arbre repliable d'un JSON ou d'un YAML : une ligne par nœud, aplatie puis virtualisée. L'état
 * déplié (`expanded`, ensemble de chemins) appartient au parent, qui le garde d'une frappe à l'autre.
 */
export function TreeView({
  value,
  expanded,
  onExpandedChange,
}: {
  value: unknown;
  expanded: ReadonlySet<string>;
  onExpandedChange: (expanded: Set<string>) => void;
}) {
  const { t } = useTranslation("preview");
  const rows = useMemo(() => flattenTree(value, expanded), [value, expanded]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Le compilateur React saute ce composant (API non mémoïsable) : sans conséquence ici.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // Chemins stables : une ligne garde son identité quand les lignes au-dessus s'ouvrent.
    getItemKey: (index) => rows[index]?.path ?? index,
  });

  function onKeyDown(event: KeyboardEvent<HTMLElement>, row: TreeRow) {
    // Le chevron a le focus programmatiquement (clic) : sa touche Entrée est déjà un clic.
    if (event.target !== event.currentTarget || !row.expandable) return;
    // État voulu : Entrée et Espace basculent, → déplie, ← replie.
    let wanted: boolean;
    if (event.key === "Enter" || event.key === " ") wanted = !row.expanded;
    else if (event.key === "ArrowRight") wanted = true;
    else if (event.key === "ArrowLeft") wanted = false;
    else return;
    event.preventDefault();
    if (wanted !== row.expanded) onExpandedChange(toggle(expanded, row.path));
  }

  function onClick(row: TreeRow) {
    if (!row.expandable) return;
    // Sélectionner du texte à la souris ne doit pas replier la ligne.
    if (window.getSelection()?.toString()) return;
    onExpandedChange(toggle(expanded, row.path));
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hairline px-3">
        <Button
          variant="ghost"
          size="xs"
          className="text-mute"
          onClick={() => onExpandedChange(expandAll(value))}
        >
          {t("data.expandAll")}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-mute"
          onClick={() => onExpandedChange(collapseAll(value))}
        >
          {t("data.collapseAll")}
        </Button>
      </div>
      <div
        ref={scrollRef}
        role="tree"
        aria-label={t("data.label")}
        className="min-h-0 min-w-0 flex-1 overflow-auto font-mono text-code text-ink"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const simple = row.text !== undefined;
            return (
              <div
                key={item.key}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.expandable ? row.expanded : undefined}
                tabIndex={0}
                onClick={() => onClick(row)}
                onKeyDown={(event) => onKeyDown(event, row)}
                className={`absolute top-0 left-0 flex w-full items-center gap-1 pr-3 outline-none select-text hover:bg-canvas-soft-2 focus-visible:bg-canvas-soft-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset${row.expandable ? " cursor-pointer" : ""}`}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: `calc(${row.depth * INDENT}px + 0.5rem)`,
                }}
              >
                {row.expandable ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-expanded={row.expanded}
                    aria-label={row.expanded ? t("data.collapse") : t("data.expand")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onExpandedChange(toggle(expanded, row.path));
                    }}
                    className="grid size-5 shrink-0 place-content-center rounded-sm text-mute hover:text-ink"
                  >
                    <ChevronRight
                      className={`size-3.5${row.expanded ? " rotate-90" : ""}`}
                      aria-hidden
                    />
                  </button>
                ) : (
                  <span aria-hidden className="size-5 shrink-0" />
                )}
                {row.label !== undefined && (
                  <span
                    title={row.label}
                    className={`max-w-1/2 shrink-0 truncate ${row.labelKind === "key" ? "data-property" : "text-mute"}`}
                  >
                    {row.label === "" ? '""' : row.label}
                    {simple && <span className="text-mute">:</span>}
                  </span>
                )}
                <span
                  title={row.full}
                  className={`min-w-0 truncate ${simple ? VALUE_CLASS[row.type] : "text-mute"}`}
                >
                  {row.text ?? row.summary}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
