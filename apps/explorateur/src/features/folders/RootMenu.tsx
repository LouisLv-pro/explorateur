import { ChevronDown, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RootFolder } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tildify } from "@/lib/paths";
import { useWorkspace } from "@/features/workspace/context";
import { useHomeDir, useRecentFolders } from "./api";

/** Nom du dossier racine (chemin en infobulle) et menu : ouvrir, récents, fermer. */
export function RootMenu({ root }: { root: RootFolder }) {
  const { t } = useTranslation("app");
  const { pickFolder, openFolder, closeFolder } = useWorkspace();
  const home = useHomeDir().data;
  const recents = (useRecentFolders().data ?? []).filter((r) => r.path !== root.path).slice(0, 5);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start">
              <span className="truncate text-body-sm-strong text-ink">{root.name}</span>
              <ChevronDown data-icon="inline-end" className="text-mute" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="font-medium">{root.name}</span>
          <br />
          {tildify(root.path, home)}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-64">
        <DropdownMenuItem onSelect={() => void pickFolder()}>
          {t("folders.open")}
          <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        {recents.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("folders.recent")}</DropdownMenuLabel>
            {recents.map((recent) => (
              <DropdownMenuItem
                key={recent.path}
                disabled={!recent.exists}
                title={tildify(recent.path, home)}
                onSelect={() => void openFolder(recent.path)}
              >
                <Folder className="text-mute" />
                <span className="truncate">{recent.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={closeFolder}>{t("folders.close")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
