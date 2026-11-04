import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { indentOf, type OutlineItem } from "./outline";

/** Retrait de base d'une entrée et par niveau (rem). */
const BASE_REM = 0.5;
const STEP_REM = 0.75;

type Props = {
  items: readonly OutlineItem[];
  /** Rang du titre lu, `-1` quand aucun n'est visible. */
  active: number;
  onSelect: (rank: number) => void;
};

/**
 * Sommaire d'un document Markdown (spec sommaire-markdown.md) : à droite du document, il défile
 * seul. Masqué quand la zone de rendu fait moins de 42 rem (conteneur `@container` de la vue).
 */
export function Outline({ items, active, onSelect }: Props) {
  const { t } = useTranslation("preview");
  const navRef = useRef<HTMLElement>(null);
  const minLevel = Math.min(...items.map((item) => item.level));

  // L'entrée du titre lu reste visible dans le panneau. On règle `scrollTop` du panneau à la
  // main : `scrollIntoView` ferait aussi défiler le document et la fenêtre.
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelectorAll("button")[active];
    if (!nav || !button) return;
    const outer = nav.getBoundingClientRect();
    const inner = button.getBoundingClientRect();
    if (inner.top < outer.top) nav.scrollTop -= outer.top - inner.top;
    else if (inner.bottom > outer.bottom) nav.scrollTop += inner.bottom - outer.bottom;
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label={t("outline.title")}
      className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-hairline p-3 @2xl:flex"
    >
      <p className="px-2 pb-1 text-caption text-mute">{t("outline.title")}</p>
      {items.map((item, rank) => (
        <button
          // Deux titres peuvent avoir le même texte : le rang identifie l'entrée.
          key={rank}
          type="button"
          aria-current={rank === active ? "location" : undefined}
          onClick={() => onSelect(rank)}
          style={{ paddingLeft: `${BASE_REM + indentOf(item.level, minLevel) * STEP_REM}rem` }}
          // La taille reste hors de `cn` : tailwind-merge confond `text-body-sm` et la couleur.
          className={`text-body-sm ${cn(
            "w-full shrink-0 truncate rounded-sm py-1 pr-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:transition-colors",
            rank === active ? "bg-hairline text-ink" : "text-mute hover:text-ink",
          )}`}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
