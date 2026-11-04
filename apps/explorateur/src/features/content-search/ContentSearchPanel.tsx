import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileHits, Hit, RootFolder } from "@/bindings";
import { Button } from "@/components/ui/button";
import { entryOf, splitRelative } from "@/features/quick-open/match";
import { EntryIcon } from "@/features/tree/EntryIcon";
import { useWorkspace } from "@/features/workspace/context";
import { cn } from "@/lib/utils";
import { isQueryLongEnough, useSearchContent } from "./api";
import { segmentsOf, summaryOf } from "./format";

/**
 * Vue Recherche du panneau de gauche (⌘⇧F) : champ, bascule de casse, résultats groupés par
 * fichier. Montée dans `<Activity>` : requête, casse et groupes repliés survivent au passage
 * par l'arborescence. `focusSeq` change à chaque ⌘⇧F : le champ reprend le focus, texte
 * sélectionné (aussi à chaque réaffichage de la vue).
 */
export function ContentSearchPanel({ root, focusSeq }: { root: RootFolder; focusSeq: number }) {
  const { t } = useTranslation("search");
  const { showHidden } = useWorkspace();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useSearchContent(root.path, query, caseSensitive, showHidden);
  const longEnough = isQueryLongEnough(query);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  function toggleGroup(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const summary = !longEnough
    ? t("tooShort")
    : search.isError
      ? t("failed")
      : search.data
        ? summaryOf(search.data)
        : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("label")}
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full rounded-sm border border-hairline bg-canvas pr-9 pl-2 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-hairline-strong"
          />
          <Button
            variant="ghost"
            size="xs"
            aria-label={t("caseSensitive")}
            title={t("caseSensitive")}
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
            className={cn(
              "absolute top-1/2 right-1 -translate-y-1/2 px-1.5 font-mono",
              caseSensitive ? "bg-hairline text-ink" : "text-mute",
            )}
          >
            {t("caseToggle")}
          </Button>
        </div>
        <p aria-live="polite" className="min-h-4 px-0.5 pt-1.5 text-caption text-mute">
          {summary}
        </p>
      </div>
      <div aria-label={t("results")} className="min-h-0 flex-1 overflow-auto pb-2">
        {longEnough &&
          search.data?.files.map((file) => (
            <FileGroup
              key={file.path}
              file={file}
              open={!collapsed.has(file.path)}
              onToggle={() => toggleGroup(file.path)}
            />
          ))}
      </div>
    </div>
  );
}

function FileGroup({
  file,
  open,
  onToggle,
}: {
  file: FileHits;
  open: boolean;
  onToggle: () => void;
}) {
  const { openFile } = useWorkspace();
  const entry = entryOf(file);
  const { name, dir } = splitRelative(file.relative_path);
  const count = file.hits.reduce((n, hit) => n + hit.ranges.length, 0);
  // Même largeur de numéro pour toutes les lignes du groupe : le texte reste aligné.
  const digits = String(file.hits.at(-1)?.line ?? 0).length;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        title={file.relative_path}
        onClick={onToggle}
        className="flex h-6.5 w-full items-center gap-1 pr-2 pl-2 text-left outline-none hover:bg-canvas-soft-2 focus-visible:bg-canvas-soft-2"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-mute motion-safe:transition-transform",
            open && "rotate-90",
          )}
        />
        <EntryIcon entry={entry} open={false} aria-hidden className="size-4 shrink-0 text-mute" />
        {/* Tailles hors de `cn` : tailwind-merge confond `text-body-sm` et `text-body`. */}
        <span className="ml-0.5 shrink-0 text-body-sm text-ink">{name}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-mute">{dir}</span>
        <span className="shrink-0 rounded-sm bg-hairline px-1.5 text-caption text-mute tabular-nums">
          {count}
        </span>
      </button>
      {open && (
        <div>
          {file.hits.map((hit) => (
            <HitRow
              key={hit.line}
              hit={hit}
              digits={digits}
              onOpen={() => openFile(entry, { line: hit.line })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HitRow({ hit, digits, onOpen }: { hit: Hit; digits: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      title={hit.text}
      onClick={onOpen}
      className="flex h-6 w-full items-center gap-2 pr-2 pl-7 text-left outline-none hover:bg-canvas-soft-2 focus-visible:bg-canvas-soft-2"
    >
      <span
        style={{ minWidth: `${digits}ch` }}
        className="shrink-0 text-right font-mono text-caption-mono text-mute tabular-nums"
      >
        {hit.line}
      </span>
      <span className="min-w-0 flex-1 truncate text-body-sm whitespace-pre text-body">
        {segmentsOf(hit.text, hit.ranges).map((segment, i) =>
          segment.match ? (
            <b key={i} className="font-semibold text-ink">
              {segment.text}
            </b>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </span>
    </button>
  );
}
