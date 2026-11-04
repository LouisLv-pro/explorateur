import { memo, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFileShortcuts } from "@/features/file-actions/actions";
import { BrowserPanel, BrowserButton } from "@/features/browser/BrowserPanel";
import { BrowserProvider } from "@/features/browser/BrowserProvider";
import { SidePanelProvider } from "@/features/browser/sidePanel";
import { CommandPalette } from "@/features/commands/CommandPalette";
import { Welcome } from "@/features/folders/Welcome";
import { GitButton, GitPanel } from "@/features/git/GitPanel";
import { GitProvider } from "@/features/git/GitProvider";
import { Preview } from "@/features/preview/Preview";
import { preloadViews } from "@/features/preview/views";
import { QuickOpen } from "@/features/quick-open/QuickOpen";
import { ServersButton } from "@/features/servers/ServersButton";
import { IssueComposerProvider } from "@/features/issues/composer";
import { ServersProvider } from "@/features/servers/ServersProvider";
import { HelpButton, HelpDialog } from "@/features/shortcuts/HelpDialog";
import { shortcutHint } from "@/features/shortcuts/shortcuts";
import { useShortcuts } from "@/features/shortcuts/useShortcuts";
import { TabBar } from "@/features/tabs/TabBar";
import { LanguageMenu } from "@/features/language/LanguageMenu";
import { AppThemeMenu, ThemeProvider } from "@/features/theme/ThemeProvider";
import { useTerminalLayout } from "@/features/terminal/context";
import { TerminalButton, TerminalPanel } from "@/features/terminal/TerminalPanel";
import { TerminalProvider } from "@/features/terminal/TerminalProvider";
import { TreePanel } from "@/features/tree/TreePanel";
import { useTreeHidden } from "@/features/tree/treeHidden";
import { DiskWatch } from "@/features/watch/DiskWatch";
import { useZoomShortcuts } from "@/features/zoom/useZoomShortcuts";
import { useWorkspace, type Workspace } from "@/features/workspace/context";
import { WorkspaceProvider } from "@/features/workspace/WorkspaceProvider";

export default function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <WorkspaceProvider>
        <SidePanelProvider>
          <BrowserProvider>
            <TerminalProvider>
              <GitProvider>
                <ServersProvider>
                  <IssueComposerProvider>
                    <ThemeProvider>
                      <Shell />
                    </ThemeProvider>
                  </IssueComposerProvider>
                </ServersProvider>
              </GitProvider>
            </TerminalProvider>
          </BrowserProvider>
        </SidePanelProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}

/** Accueil sans dossier ouvert ; sinon arborescence à gauche et aperçu à droite. */
function Shell() {
  const { root } = useWorkspace();
  useFileShortcuts();
  useZoomShortcuts();
  // Éditeur, Markdown, données et langages courants : chargés pendant les temps morts une fois
  // le dossier affiché, pour que le premier fichier de chaque type s'affiche coloré, sans
  // attente et sans ralentir le lancement.
  useEffect(() => {
    if (root) preloadViews();
  }, [root]);
  return <ShellBody root={root} />;
}

/**
 * Corps de `Shell`, mémoïsé : changer d'onglet ne change que l'espace de travail, pas `root`.
 * Seuls les composants qui lisent l'espace de travail se redessinent alors, pas toute la
 * mise en page (barre d'onglets, aide, palette, panneaux).
 */
const ShellBody = memo(function ShellBody({ root }: { root: Workspace["root"] }) {
  const [treeHidden, setTreeHidden] = useTreeHidden();
  const [helpOpen, setHelpOpen] = useState(false);
  const showHelp = () => setHelpOpen(true);
  const terminal = useTerminalLayout();
  const terminalMaximized = terminal.visible && terminal.maximized;

  // ?, ⌥⌘S. Les autres raccourcis (⇧⌘L : `ThemeProvider`) sont écoutés par la fonctionnalité
  // qu'ils concernent.
  useShortcuts((action, event) => {
    if (action === "help") {
      event.preventDefault();
      showHelp();
    } else if (action === "toggle-tree" && root) {
      event.preventDefault();
      setTreeHidden((hidden) => !hidden);
    }
  });

  // Le panneau Terminal reste monté à la même place de l'arbre React, dossier ouvert ou non :
  // changer de dossier racine ou revenir à l'accueil ne tue aucun shell.
  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      {root && (
        <TreePanel
          key={root.path}
          root={root}
          hidden={treeHidden}
          onShow={() => setTreeHidden(false)}
          onHelp={showHelp}
        />
      )}
      {/* `relative` : le navigateur agrandi couvre toute cette zone, à droite de l'arborescence. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Barre d'onglets sur toute la largeur (aperçu et volet Modifications) ; masquée,
            comme l'aperçu, quand le terminal est agrandi. */}
        {root && !terminalMaximized && (
          <TabBar
            leading={
              treeHidden && (
                <>
                  <ShowTreeButton onClick={() => setTreeHidden(false)} />
                  <AppThemeMenu side="bottom" align="start" />
                  <LanguageMenu side="bottom" align="start" />
                  <HelpButton onClick={showHelp} side="bottom" />
                </>
              )
            }
            trailing={
              <>
                <ServersButton />
                <GitButton root={root} />
                <BrowserButton />
                <TerminalButton />
              </>
            }
          />
        )}
        <div className="flex min-h-0 flex-1">
          {/* Aperçu et terminal en colonne, à gauche du volet Modifications. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {root ? (
              <Preview root={root} hidden={terminalMaximized} />
            ) : (
              <div className="min-h-0 flex-1">
                <Welcome onHelp={showHelp} />
              </div>
            )}
            <TerminalPanel disabled={root === null} />
          </div>
          {root && <GitPanel key={root.path} root={root} />}
          {/* Monté aussi sur l'accueil et à travers les dossiers : les pages gardent leur état. */}
          <BrowserPanel />
        </div>
      </div>
      {root && (
        <>
          <QuickOpen root={root} />
          <DiskWatch rootPath={root.path} />
        </>
      )}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette />
    </div>
  );
});

/** Bouton de la barre d'onglets qui réaffiche l'arborescence masquée par ⌥⌘S. */
function ShowTreeButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("app");
  const label = t("showTree");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className="text-mute"
        >
          <PanelLeft />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{`${label} (${shortcutHint("toggle-tree")})`}</TooltipContent>
    </Tooltip>
  );
}
