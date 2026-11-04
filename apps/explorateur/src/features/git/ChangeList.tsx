// Liste des modifications : sections « Indexées » et « Modifications », repliables, avec
// l'intertitre « Hors du dossier » pour les fichiers du dépôt hors du dossier racine. Lot 2 :
// gestes au survol des lignes et de l'intertitre de section.
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileChange } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntryIcon } from "@/features/tree/EntryIcon";
import { cn } from "@/lib/utils";
import { ActionButtons } from "./ActionButtons";
import {
  canOpen,
  changeActions,
  changeKey,
  entryOfChange,
  splitPath,
  type ChangeAction,
} from "./model";
import { LineCounts, StatusLetter } from "./StatusLetter";

export type SectionId = "staged" | "unstaged";

type RowHandlers = {
  /** Ligne de la liste qui porte le focus clavier (une seule `tabIndex=0`). */
  currentKey: string | null;
  /** Clic ou ↵ : défile jusqu'au diff et le déplie. */
  onReveal: (change: FileChange) => void;
  /** Double-clic ou ⇧↵ : ouvre le fichier en onglet épinglé. */
  onOpen: (change: FileChange) => void;
  onFocusRow: (key: string) => void;
  /** Bouton de geste (Indexer, Désindexer, Annuler) d'une ligne. */
  onAction: (change: FileChange, action: ChangeAction) => void;
};

export function ChangeSection({
  id,
  title,
  changes,
  collapsed,
  onToggle,
  onAll,
  ...handlers
}: {
  id: SectionId;
  title: string;
  changes: readonly FileChange[];
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
  /** « Tout indexer » (Modifications) ou « Tout désindexer » (Indexées). */
  onAll: (id: SectionId) => void;
} & RowHandlers) {
  const { t } = useTranslation("git");
  const inside = changes.filter((c) => !c.outsideRoot);
  const outside = changes.filter((c) => c.outsideRoot);
  const allLabel = id === "staged" ? t("panel.unstageAll") : t("panel.stageAll");
  const AllIcon = id === "staged" ? Minus : Plus;
  return (
    <section aria-label={title}>
      <div className="group flex h-7 items-center pr-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggle(id)}
          className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left font-mono text-caption-mono text-mute uppercase outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 motion-safe:transition-transform", !collapsed && "rotate-90")}
          />
          {title}
          <span className="ml-1 rounded-xs bg-hairline px-1 text-body">{changes.length}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-label={allLabel}
              onClick={() => onAll(id)}
              className="hidden text-mute group-focus-within:inline-flex group-hover:inline-flex hover:text-ink"
            >
              <AllIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{allLabel}</TooltipContent>
        </Tooltip>
      </div>
      {!collapsed && (
        <ul>
          {inside.map((change) => (
            <ChangeRow key={changeKey(change)} change={change} {...handlers} />
          ))}
          {outside.length > 0 && (
            <li
              role="presentation"
              className="px-6 pt-2 pb-1 font-mono text-caption-mono text-mute"
            >
              {t("panel.outside")}
            </li>
          )}
          {outside.map((change) => (
            <ChangeRow key={changeKey(change)} change={change} {...handlers} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  currentKey,
  onReveal,
  onOpen,
  onFocusRow,
  onAction,
}: { change: FileChange } & RowHandlers) {
  const key = changeKey(change);
  const { name, dir } = splitPath(change.path);
  const openable = canOpen(change);
  return (
    <li className="group relative">
      <button
        type="button"
        data-git-row={key}
        tabIndex={key === currentKey ? 0 : -1}
        title={change.origPath === null ? change.path : `${change.origPath} → ${change.path}`}
        onFocus={() => onFocusRow(key)}
        onClick={(event) => {
          // WebKit ne donne pas le focus à un bouton cliqué.
          event.currentTarget.focus();
          onReveal(change);
        }}
        onDoubleClick={() => {
          if (openable) onOpen(change);
        }}
        className="flex h-6.5 w-full items-center gap-1.5 pr-3 pl-6 text-left text-body outline-none hover:bg-canvas-soft-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <EntryIcon
          entry={entryOfChange(change, "/")}
          open={false}
          className="size-4 shrink-0 text-mute"
          aria-hidden
        />
        {/* Taille hors de `cn` : tailwind-merge confond `text-body-sm` et `text-body`. */}
        <span
          className={cn(
            "min-w-0 truncate text-ink",
            change.status === "D" && "line-through decoration-mute",
          )}
        >
          <span className="text-body-sm">
            {change.origPath !== null && `${splitPath(change.origPath).name} → `}
            {name}
          </span>
        </span>
        {/* Dossier tronqué au début : la fin du chemin est la plus parlante. */}
        <span dir="rtl" className="min-w-0 flex-1 truncate text-left text-caption text-mute">
          <bdi>{dir}</bdi>
        </span>
        <LineCounts added={change.added} removed={change.removed} />
        <StatusLetter status={change.status} />
      </button>
      {/* Au survol : couvre `+N −M`, à gauche de la lettre de statut. */}
      <ActionButtons
        actions={changeActions(change)}
        onAction={(action) => onAction(change, action)}
        className="absolute inset-y-0 right-6 hidden bg-canvas-soft-2 pl-1 group-hover:flex"
      />
    </li>
  );
}
