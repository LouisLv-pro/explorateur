import { useTranslation } from "react-i18next";
import type { ChangeStatus } from "@/bindings";
import { cn } from "@/lib/utils";
import { STATUS_STYLE } from "./marks";

/** Lettre de statut colorée (`M`, `A`, `D`, `R`, `U`, `!`), nommée pour les lecteurs d'écran. */
export function StatusLetter({ status }: { status: ChangeStatus }) {
  // Abonne le composant à la langue : `label` est traduit à la lecture.
  useTranslation("git");
  const { label, text: color } = STATUS_STYLE[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("w-3 shrink-0 text-center font-mono font-medium", color)}
    >
      {status}
    </span>
  );
}

/** `+N −M` : lignes ajoutées et supprimées (rien si les deux sont nulles, binaire compris). */
export function LineCounts({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="flex shrink-0 gap-1 font-mono text-caption-mono">
      {added > 0 && <span className="text-vcs-added">+{added}</span>}
      {removed > 0 && <span className="text-vcs-deleted">−{removed}</span>}
    </span>
  );
}
