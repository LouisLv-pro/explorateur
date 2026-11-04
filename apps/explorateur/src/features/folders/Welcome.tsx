import { FolderOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { RecentFolder } from "@/bindings";
import { Button } from "@/components/ui/button";
import { tildify } from "@/lib/paths";
import { BrowserButton } from "@/features/browser/BrowserPanel";
import { HelpButton } from "@/features/shortcuts/HelpDialog";
import { LanguageMenu } from "@/features/language/LanguageMenu";
import { AppThemeMenu } from "@/features/theme/ThemeProvider";
import { useWorkspace } from "@/features/workspace/context";
import { useHomeDir, useRecentFolders, useRemoveRecentFolder } from "./api";

/** Écran d'accueil : aucun dossier ouvert. */
export function Welcome({ onHelp }: { onHelp: () => void }) {
  const { t } = useTranslation("app");
  const { pickFolder } = useWorkspace();
  const recents = useRecentFolders();

  return (
    <main className="relative grid h-full place-items-center overflow-auto p-6">
      {/* Boutons de l'app, en haut à droite. */}
      <div className="absolute top-2 right-2 flex items-center gap-0.5">
        <BrowserButton />
        <AppThemeMenu side="bottom" />
        <LanguageMenu side="bottom" />
        <HelpButton onClick={onHelp} side="bottom" />
      </div>
      <div className="grid w-full max-w-lg gap-8">
        <div className="grid gap-4">
          {/* Nom propre de l'app : jamais traduit. */}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="font-mono text-caption-mono text-mute uppercase">explorateur</p>
          <Button size="lg" className="w-fit" onClick={() => void pickFolder()}>
            <FolderOpen data-icon="inline-start" />
            {t("folders.open")}
            <kbd className="ml-2 font-mono text-caption-mono opacity-70">⌘O</kbd>
          </Button>
        </div>

        {recents.data && recents.data.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-body-sm-strong text-ink">{t("folders.recent")}</h2>
            <ul className="grid">
              {recents.data.map((recent) => (
                <RecentRow key={recent.path} recent={recent} />
              ))}
            </ul>
          </section>
        )}

        <p className="text-body-sm text-mute">{t("folders.dropHint")}</p>
      </div>
    </main>
  );
}

function RecentRow({ recent }: { recent: RecentFolder }) {
  const { t } = useTranslation("app");
  const { openFolder } = useWorkspace();
  const home = useHomeDir().data;
  const remove = useRemoveRecentFolder();

  return (
    <li className="group flex items-center gap-1 rounded-sm hover:bg-canvas-soft-2">
      <button
        type="button"
        disabled={!recent.exists}
        onClick={() => void openFolder(recent.path)}
        className={cn(
          "grid min-w-0 flex-1 gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          !recent.exists && "cursor-default opacity-50",
        )}
      >
        <span className="truncate text-body-sm-strong text-ink">{recent.name}</span>
        <span className="truncate text-caption text-mute">{tildify(recent.path, home)}</span>
      </button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => remove.mutate(recent.path)}
        className={cn(
          "mr-1 text-mute",
          recent.exists && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X data-icon="inline-start" />
        {t("folders.remove")}
      </Button>
    </li>
  );
}
