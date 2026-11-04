import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ContextActionItems } from "@/features/file-actions/actions";
import { useGitMarksContext } from "@/features/git/context";
import { entryMark, nameClass } from "@/features/git/marks";
import { IssueTabIcon } from "@/features/issues/IssueTabIcon";
import { ServerTabIcon } from "@/features/servers/ServerTabIcon";
import { EntryIcon } from "@/features/tree/EntryIcon";
import { useWorkspace } from "@/features/workspace/context";
import { relativePath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { entryOfTab, type Tab } from "./tabs";

/**
 * Barre d'onglets au-dessus de l'aperçu : défile horizontalement, ramène l'onglet actif en vue.
 * `leading` : boutons fixes à sa gauche (arborescence masquée), hors de la liste des onglets.
 * `trailing` : boutons fixes à sa droite (Terminal).
 */
export function TabBar({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  const { tabs, activeTab } = useWorkspace();
  const { t } = useTranslation("app");

  return (
    <div className="flex shrink-0">
      {Boolean(leading) && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-r border-b border-hairline bg-canvas-soft px-1.5">
          {leading}
        </div>
      )}
      <div
        role="tablist"
        aria-label={t("tabs.list")}
        className="flex h-9 min-w-0 flex-1 overflow-x-auto border-b border-hairline bg-canvas-soft [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <TabItem key={tab.id ?? tab.path} tab={tab} active={tab.path === activeTab?.path} />
        ))}
      </div>
      {Boolean(trailing) && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-hairline bg-canvas-soft px-1.5">
          {trailing}
        </div>
      )}
    </div>
  );
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const { root, tabs, activateTab, pinTab, closeTab, closeOtherTabs } = useWorkspace();
  const { t } = useTranslation(["app", "common"]);
  const ref = useRef<HTMLDivElement>(null);
  // Nom coloré selon le statut git (lot 3) ; le point « non enregistré » reste sur le bouton.
  const { marks } = useGitMarksContext();
  // Aperçu d'un serveur ou issue : ni fichier, ni couleur git, ni actions fichier.
  const isFile = tab.server === undefined && tab.issue === undefined;
  const color = root && isFile ? nameClass(entryMark(marks, root.path, tab.path, false)) : null;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function onAuxClick(event: MouseEvent) {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(tab.path);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTab(tab.path);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          role="tab"
          tabIndex={0}
          aria-selected={active}
          title={!isFile ? tab.name : root ? relativePath(tab.path, root.path) : tab.path}
          onClick={() => activateTab(tab.path)}
          onDoubleClick={() => pinTab(tab.path)}
          onMouseDown={(event) => {
            // Évite le défilement automatique du clic du milieu.
            if (event.button === 1) event.preventDefault();
          }}
          onAuxClick={onAuxClick}
          onKeyDown={onKeyDown}
          className={cn(
            "group relative flex h-full max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r border-hairline pr-1.5 pl-2.5 outline-none select-none focus-visible:bg-canvas-soft-2",
            active
              ? "bg-canvas text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-canvas"
              : "text-mute hover:bg-canvas-soft-2",
          )}
        >
          {tab.server !== undefined ? (
            <ServerTabIcon serverKey={tab.server} />
          ) : tab.issue !== undefined ? (
            <IssueTabIcon
              number={tab.issue}
              initial={tab.issueState ?? "OPEN"}
              className="size-4 shrink-0"
            />
          ) : (
            <EntryIcon
              entry={entryOfTab(tab)}
              open={false}
              className="size-4 shrink-0"
              aria-hidden
            />
          )}
          {/* Taille hors de `cn` : tailwind-merge confond `text-body-sm` et une couleur. */}
          <span className={`${cn("truncate pr-0.5", !tab.pinned && "italic", color)} text-body-sm`}>
            {tab.name}
            {tab.dirty && <span className="sr-only">{t("tabs.modified")}</span>}
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("tabs.close", { name: tab.name })}
            onClick={(event) => {
              event.stopPropagation();
              closeTab(tab.path);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className={cn(
              "grid size-5 shrink-0 place-content-center rounded-sm text-mute hover:bg-hairline hover:text-ink",
              active || tab.dirty
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            {/* Modifications non enregistrées : un point à la place du ×, sauf au survol. */}
            {tab.dirty && (
              <span aria-hidden className="size-2 rounded-full bg-ink group-hover:hidden" />
            )}
            <X className={cn("size-3.5", tab.dirty && "hidden group-hover:block")} aria-hidden />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem onSelect={() => closeTab(tab.path)}>{t("common:close")}</ContextMenuItem>
        <ContextMenuItem disabled={tabs.length < 2} onSelect={() => closeOtherTabs(tab.path)}>
          {t("tabs.closeOthers")}
        </ContextMenuItem>
        {/* Aperçu d'un serveur ou issue : pas de fichier, donc pas d'actions fichier. */}
        {isFile && (
          <>
            <ContextMenuSeparator />
            <ContextActionItems path={tab.path} isDir={false} code />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
