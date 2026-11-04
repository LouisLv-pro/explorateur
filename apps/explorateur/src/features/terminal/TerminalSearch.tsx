// Barre de recherche d'une page du terminal (⌘F, docs/specs/terminal.md, lot 2) : ↵ suivant,
// ⇧↵ précédent, Échap ferme et rend le focus au terminal. La correspondance est sélectionnée
// dans le terminal (addon search d'xterm).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { SearchAddon } from "@xterm/addon-search";
import { Button } from "@/components/ui/button";

export function TerminalSearch({
  search,
  focusSeq,
  onClose,
}: {
  search: SearchAddon;
  /** Incrémenté à chaque ⌘F : le champ reprend le focus, texte sélectionné. */
  focusSeq: number;
  onClose: () => void;
}) {
  const { t } = useTranslation("terminal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  function find(direction: "next" | "previous", term = query, incremental = false) {
    if (term === "") {
      search.clearDecorations();
      setMissing(false);
      return;
    }
    const found =
      direction === "next" ? search.findNext(term, { incremental }) : search.findPrevious(term);
    setMissing(!found);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      find(event.shiftKey ? "previous" : "next");
    } else if (event.metaKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.currentTarget.select();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      role="search"
      className="absolute top-1 right-3 z-10 flex items-center gap-0.5 rounded-md border border-hairline bg-canvas p-1 shadow-level-2"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          find("next", event.target.value, true);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        aria-invalid={missing || undefined}
        autoComplete="off"
        spellCheck={false}
        className="h-6 w-48 rounded-sm border border-hairline bg-canvas px-2 text-body-sm text-ink outline-none placeholder:text-mute focus-visible:border-hairline-strong aria-invalid:border-error"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("search.previous")}
        title={t("search.previous")}
        onClick={() => find("previous")}
        className="text-mute"
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("search.next")}
        title={t("search.next")}
        onClick={() => find("next")}
        className="text-mute"
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("search.close")}
        title={t("search.close")}
        onClick={onClose}
        className="text-mute"
      >
        <X />
      </Button>
    </div>
  );
}
