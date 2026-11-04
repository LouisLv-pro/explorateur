import { useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/i18n/format";
import type { CsvTable } from "./parse";
import { cellText, delimiterLabel, layoutTable } from "./table";

/** Hauteur d'une ligne et de l'en-tête, en px : fixe, donc sans mesure par ligne. */
const ROW_HEIGHT = 28;
/** Marge intérieure d'une cellule (`px-3` de chaque côté), ajoutée à la largeur en `ch`. */
const CELL_PADDING = "1.5rem";

/**
 * Tableau d'un CSV ou d'un TSV : en-tête et numéros de ligne figés, lignes virtualisées. Une
 * grille CSS (et non un `<table>`) partage ses colonnes entre l'en-tête et les lignes absolues
 * du virtualiseur, qui restent donc alignées. Un seul conteneur défile, dans les deux sens.
 */
export function TableView({ table }: { table: CsvTable }) {
  const { t } = useTranslation("preview");
  const { rows, delimiter } = table;
  const layout = useMemo(() => layoutTable(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = Math.max(0, rows.length - 1);
  // Le compilateur React saute ce composant (API non mémoïsable) : sans conséquence ici.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // L'en-tête fait partie du défilement : les lignes commencent après lui.
    scrollMargin: ROW_HEIGHT,
  });

  // Numéros de ligne : de quoi écrire le plus grand, en `ch`.
  const gutter = Math.max(2, String(count).length);
  const grid = useMemo(() => {
    const tracks = [gutter, ...layout.widths].map((w) => `calc(${w}ch + ${CELL_PADDING})`);
    const total = gutter + layout.widths.reduce((sum, w) => sum + w, 0);
    return {
      "--cols": tracks.join(" "),
      "--width": `calc(${total}ch + ${layout.columns + 1} * ${CELL_PADDING})`,
    } as CSSProperties;
  }, [gutter, layout]);

  const header = rows[0] ?? [];
  // La taille du texte d'en-tête est sur les cellules, pas sur la ligne : les `ch` des colonnes
  // se calculent sur la ligne, donc avec la même police pour l'en-tête et les lignes.
  // Sans `cn` : tailwind-merge prendrait `text-caption-mono` (taille) pour une couleur.
  const cellClass = (column: number, head = false) =>
    `truncate px-3 ${head ? "py-1.5 text-caption-mono text-mute" : "py-1"}${layout.numeric[column] ? " text-right" : ""}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <div
        ref={scrollRef}
        role="table"
        aria-rowcount={rows.length}
        aria-colcount={layout.columns}
        className="min-h-0 min-w-0 flex-1 overflow-auto font-mono text-code text-ink"
      >
        <div className="relative min-w-full" style={{ ...grid, width: "var(--width)" }}>
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid border-b border-hairline bg-canvas-soft"
            style={{ gridTemplateColumns: "var(--cols)", height: ROW_HEIGHT }}
          >
            <div
              aria-hidden
              className="sticky left-0 z-20 border-r border-hairline bg-canvas-soft"
            />
            {Array.from({ length: layout.columns }, (_, c) => {
              const label = cellText(header[c] ?? "");
              return (
                <div key={c} role="columnheader" title={label} className={cellClass(c, true)}>
                  {label}
                </div>
              );
            })}
          </div>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index + 1] ?? [];
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className="absolute top-0 left-0 grid border-b border-hairline"
                  style={{
                    gridTemplateColumns: "var(--cols)",
                    width: "var(--width)",
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start - ROW_HEIGHT}px)`,
                  }}
                >
                  <div
                    aria-hidden
                    className="sticky left-0 z-1 border-r border-hairline bg-canvas px-3 py-1 text-right text-mute select-none"
                  >
                    {item.index + 1}
                  </div>
                  {Array.from({ length: layout.columns }, (_, c) => {
                    const text = cellText(row[c] ?? "");
                    return (
                      <div key={c} role="cell" title={text} className={cellClass(c)}>
                        {text}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="shrink-0 border-t border-hairline px-4 py-1 text-caption-mono text-mute">
        {t("table.footer", {
          rows: t("table.rows", { count, n: formatNumber(count) }),
          columns: t("table.columns", { count: layout.columns, n: formatNumber(layout.columns) }),
          delimiter: t("table.delimiter", { name: delimiterLabel(delimiter) }),
        })}
      </p>
    </div>
  );
}
