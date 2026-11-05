import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, events, type AppError, type RootFolder } from "@/bindings";
import { openErrorMessage, recentFoldersKey, useLastRoot } from "@/features/folders/api";
import { DropOverlay, useFolderDrop } from "@/features/folders/drop";
import { TrashDialog } from "@/features/file-actions/TrashDialog";
import { writeErrorMessage } from "@/features/file-actions/errors";
import {
  getDocument,
  isDirty,
  pruneDocuments,
  saveDocument,
  subscribeDocuments,
} from "@/features/editor/documents";
import { pruneNotebookKernels } from "@/features/notebook/kernel";
import { SaveChangesDialog, UnsavedChangesDialog } from "@/features/editor/UnsavedDialogs";
import { shortcutLabel } from "@/features/commands/registry";
import { useCommand } from "@/features/commands/store";
import { removeHistoryUnder, renameHistory } from "@/features/history/history";
import { existingPaths } from "@/features/session/existence";
import {
  EMPTY_SESSION,
  loadSession,
  removeRecentUnder,
  renameRecent,
  restoreTabs,
  saveSession,
  sessionOf,
  type StoredSession,
} from "@/features/session/session";
import { tabRankOf } from "@/features/shortcuts/shortcuts";
import { globalAction, useShortcuts } from "@/features/shortcuts/useShortcuts";
import {
  activateTab,
  activateTabAt,
  closeOtherTabs,
  closeTab,
  closeTabsUnder,
  dirtyTabsUnder,
  entryOfTab,
  nextTab,
  openIssueTab,
  openServerTab,
  openTab,
  pinTab,
  renameTabs,
  setTabDirty,
  tabKey,
  type Tab,
  type TabsState,
} from "@/features/tabs/tabs";
import i18n from "@/i18n";
import { parentPath } from "@/lib/paths";
import { runningCommands } from "@/features/terminal/api";
import { quitConfirmation, type ConfirmText } from "@/features/terminal/confirm";
import { isInBrowserPage } from "@/features/browser/focus";
import { isInTerminal } from "@/features/terminal/context";
import { StopDialog } from "@/features/terminal/StopDialog";
import { ErrorBanner } from "./ErrorBanner";
import { Notice } from "./Notice";
import { OpenLinkDialog } from "./OpenLinkDialog";
import { openEntries, planOpen, type RootPlan } from "./open-target";
import { EMPTY_STATE, canMove, moveInHistory, withTabs, type SessionState } from "./session-state";
import {
  RecentFilesContext,
  WorkspaceActionsContext,
  WorkspaceContext,
  type TrashTarget,
  type Workspace,
  type WorkspaceActions,
} from "./context";

/** Boîte ouverte à cause de modifications non enregistrées. */
type UnsavedRequest =
  | { kind: "close"; tab: Tab }
  | { kind: "others"; path: string; count: number }
  /** Quitter : fichiers modifiés et commandes en cours dans le terminal (une seule boîte). */
  | { kind: "quit"; text: ConfirmText }
  /** Changer de dossier racine ou revenir à l'accueil : `proceed` s'exécute si on confirme. */
  | { kind: "folder"; count: number; proceed: () => void };

/** Reporte l'état modifié des documents de l'éditeur sur les onglets. */
function syncDirty(state: TabsState): TabsState {
  return state.tabs.reduce(
    (s, tab) => setTabDirty(s, tab.path, isDirty(getDocument(tabKey(tab)))),
    state,
  );
}

// L'accès à `localStorage` lui-même peut lever (stockage refusé) : session vide, non enregistrée.
function readStoredSession(root: string): StoredSession {
  try {
    return loadSession(localStorage, root);
  } catch {
    return EMPTY_SESSION;
  }
}

function writeStoredSession(root: string, session: StoredSession): void {
  try {
    saveSession(localStorage, root, session);
  } catch {
    // Non enregistrée : la session vaut jusqu'à la fermeture de l'app.
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const lastRoot = useLastRoot();
  // Vrai quand la cible du Finder reçue au lancement est appliquée (ou qu'il n'y en a pas).
  const [launchSettled, setLaunchSettled] = useState(false);
  const launchHandled = useRef(false);
  // `undefined` tant que l'utilisateur n'a rien choisi : le dernier dossier s'applique.
  const [chosenRoot, setChosenRoot] = useState<RootFolder | null | undefined>(undefined);
  // Onglets, historique ⌃⌘← / ⌃⌘→, récents, et dossier racine à qui ils appartiennent
  // (spec continuite.md) : une seule valeur, pour que la remise à zéro en changeant de dossier
  // et le changement de propriétaire arrivent ensemble (rien n'écrase la session d'un dossier).
  const [session, setSession] = useState<SessionState>(EMPTY_STATE);
  const tabsState = session.tabs;
  /** Change les onglets ; l'onglet devenu actif entre dans l'historique et les récents. */
  const setTabsState = useCallback(
    (update: (state: TabsState) => TabsState) => setSession((s) => withTabs(s, update(s.tabs))),
    [],
  );
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<TrashTarget | null>(null);
  const [unsavedRequest, setUnsavedRequest] = useState<UnsavedRequest | null>(null);
  // Autre dossier racine demandé par un lien ou la CLI, en attente de « Ouvrir » (décision 0013).
  const [linkPlan, setLinkPlan] = useState<RootPlan | null>(null);
  const root = chosenRoot !== undefined ? chosenRoot : (lastRoot.data ?? null);

  /**
   * Rétablit la session du dossier `rootPath` (spec continuite.md) : onglets vidés et historique
   * remis à zéro tout de suite, récents relus, puis les onglets dont le fichier existe encore.
   * Abandonné si les onglets changent entre-temps (fichier ouvert, autre dossier).
   */
  const restoreSession = useCallback(
    async (rootPath: string) => {
      const stored = readStoredSession(rootPath);
      setSession({ ...EMPTY_STATE, owner: rootPath, restoring: true, recent: stored.recent });
      const existing =
        stored.tabs.length > 0
          ? await existingPaths(
              queryClient,
              stored.tabs.map((t) => t.path),
            )
          : new Set<string>();
      setSession((s) =>
        s.owner === rootPath && s.restoring
          ? withTabs(
              { ...s, restoring: false },
              restoreTabs(stored, (path) => existing.has(path)),
            )
          : s,
      );
    },
    [queryClient],
  );

  /**
   * Appelle `open_root`, puis rétablit la session du dossier ; renvoie l'erreur au lieu de
   * l'afficher. Les fichiers reçus (Finder, lien) s'ouvrent après, comme avant.
   */
  const tryOpen = useCallback(
    async (path: string): Promise<AppError | null> => {
      const result = await commands.openRoot(path);
      void queryClient.invalidateQueries({ queryKey: recentFoldersKey });
      if (result.status === "error") return result.error;
      setChosenRoot(result.data);
      setError(null);
      await restoreSession(result.data.path);
      return null;
    },
    [queryClient, restoreSession],
  );

  const dirtyCount = tabsState.tabs.filter((t) => t.dirty).length;

  /** Exécute `action` tout de suite, ou après confirmation s'il reste des modifications. */
  const confirmLeavingFolder = useCallback(
    (action: () => void) => {
      if (dirtyCount > 0) setUnsavedRequest({ kind: "folder", count: dirtyCount, proceed: action });
      else action();
    },
    [dirtyCount],
  );

  const openFolder = useCallback(
    async (path: string) =>
      confirmLeavingFolder(() => {
        void tryOpen(path).then((err) => {
          if (err) setError(openErrorMessage(err));
        });
      }),
    [tryOpen, confirmLeavingFolder],
  );

  /** Autre dossier racine reçu (Finder, lien confirmé) : comme ⌘O, puis les fichiers. */
  const openPlanRoot = useCallback(
    (plan: RootPlan) =>
      confirmLeavingFolder(() => {
        void tryOpen(plan.root).then((err) => {
          if (err) setError(openErrorMessage(err));
          else setTabsState((s) => openEntries(s, plan.files, plan.line));
        });
      }),
    [tryOpen, confirmLeavingFolder, setTabsState],
  );

  const pickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await openFolder(selected);
  }, [openFolder]);

  /** Mise à la corbeille confirmée : relit le dossier parent, ferme les onglets concernés. */
  const confirmTrash = useCallback(
    async (target: TrashTarget) => {
      setTrashTarget(null);
      const result = await commands.moveToTrash(target.path);
      if (result.status === "error") {
        setError(writeErrorMessage(result.error));
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["list_directory", parentPath(target.path)],
      });
      // Historique et récents perdent le chemin et ses fichiers.
      setSession((s) =>
        withTabs(
          {
            ...s,
            history: removeHistoryUnder(s.history, target.path),
            recent: removeRecentUnder(s.recent, target.path),
          },
          closeTabsUnder(s.tabs, target.path),
        ),
      );
      setNotice(i18n.t("app:workspace.trashed"));
    },
    [queryClient],
  );

  const activeTab = tabsState.tabs.find((t) => t.path === tabsState.active) ?? null;

  /** Ferme l'onglet `path`, après confirmation s'il a des modifications non enregistrées. */
  const requestCloseTab = useCallback(
    (path: string) => {
      const tab = tabsState.tabs.find((t) => t.path === path);
      if (tab?.dirty) setUnsavedRequest({ kind: "close", tab });
      else setTabsState((s) => closeTab(s, path));
    },
    [tabsState.tabs, setTabsState],
  );

  const requestCloseOthers = useCallback(
    (path: string) => {
      const count = tabsState.tabs.filter((t) => t.path !== path && t.dirty).length;
      if (count > 0) setUnsavedRequest({ kind: "others", path, count });
      else setTabsState((s) => closeOtherTabs(s, path));
    },
    [tabsState.tabs, setTabsState],
  );

  /** « Enregistrer » de la boîte de fermeture : l'onglet se ferme si l'écriture réussit. */
  const saveAndClose = useCallback(
    async (tab: Tab) => {
      setUnsavedRequest(null);
      if (await saveDocument(tabKey(tab), tab.path)) setTabsState((s) => closeTab(s, tab.path));
      // Échec : l'onglet reste, actif, avec sa bannière d'erreur.
      else setTabsState((s) => activateTab(s, tab.path));
    },
    [setTabsState],
  );

  // Actions stables (fonctions de mise à jour de React) : un contexte à part, que la ligne de
  // l'arborescence ou l'aperçu Markdown lisent sans suivre les onglets.
  const actions = useMemo(
    (): WorkspaceActions => ({
      openFile: (entry, options = {}) => setTabsState((s) => openTab(s, entry, options)),
      openServerTab: (key, name) => setTabsState((s) => openServerTab(s, key, name)),
      openIssueTab: (repo, number, name, state, options) =>
        setTabsState((s) => openIssueTab(s, repo, number, name, state, options)),
      pinTab: (path) => setTabsState((s) => pinTab(s, path)),
      activateTab: (path) => setTabsState((s) => activateTab(s, path)),
      // Historique et récents suivent le renommage, comme les onglets.
      renameTabs: (from, to) =>
        setSession((s) =>
          withTabs(
            {
              ...s,
              history: renameHistory(s.history, from, to),
              recent: renameRecent(s.recent, from, to),
            },
            renameTabs(s.tabs, from, to),
          ),
        ),
      requestTrash: setTrashTarget,
      cycleTab: (direction) => setTabsState((s) => nextTab(s, direction)),
      toggleHidden: () => setShowHidden((v) => !v),
      showError: setError,
      notify: setNotice,
    }),
    [setTabsState],
  );

  const workspace = useMemo(
    (): Workspace => ({
      ...actions,
      root,
      tabs: tabsState.tabs,
      activeTab,
      // L'aperçu d'un serveur et une issue ne sont pas des fichiers : pas d'actions fichier.
      currentFile:
        activeTab && activeTab.server === undefined && activeTab.issue === undefined
          ? entryOfTab(activeTab)
          : null,
      closeTab: requestCloseTab,
      closeOtherTabs: requestCloseOthers,
      showHidden,
      openFolder,
      pickFolder,
      closeFolder() {
        confirmLeavingFolder(() => {
          setChosenRoot(null);
          // Sans propriétaire : les onglets vidés ne s'enregistrent pas (la session reste).
          setSession(EMPTY_STATE);
        });
      },
    }),
    [
      actions,
      root,
      tabsState.tabs,
      activeTab,
      showHidden,
      openFolder,
      pickFolder,
      requestCloseTab,
      requestCloseOthers,
      confirmLeavingFolder,
    ],
  );

  // L'état modifié vit dans les documents de l'éditeur : les onglets le reflètent (point, épinglage).
  useEffect(() => subscribeDocuments(() => setTabsState(syncDirty)), [setTabsState]);

  // Documents des onglets fermés : oubliés ; leurs noyaux Jupyter, arrêtés.
  useEffect(() => {
    const keys = new Set(tabsState.tabs.map(tabKey));
    pruneDocuments(keys);
    pruneNotebookKernels(keys);
  }, [tabsState.tabs]);

  // Rust demande confirmation au front avant de quitter s'il reste des modifications (menu.rs).
  const hasUnsaved = dirtyCount > 0;
  useEffect(() => {
    void commands.setUnsavedChanges(hasUnsaved).catch(() => {});
  }, [hasUnsaved]);

  // Titre de la fenêtre : `<nom> · explorateur`.
  const title = root ? `${root.name} · explorateur` : "explorateur";
  useEffect(() => {
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  }, [title]);

  // ⌘O partout, même avec un dossier ouvert. ⌃Tab / ⌃⇧Tab : onglet suivant / précédent.
  // Écouteur d'avant la table des raccourcis : il agit même avec un menu ou un dialogue ouvert.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const action = globalAction(event);
    if (action === "open-folder") {
      event.preventDefault();
      void pickFolder();
    } else if (action === "next-tab" || action === "previous-tab") {
      event.preventDefault();
      setTabsState((s) => nextTab(s, action === "previous-tab" ? -1 : 1));
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ⌘1 à ⌘8 : onglet de ce rang ; ⌘9 : le dernier. ⌃⌘← / ⌃⌘→ : fichier précédent / suivant.
  useShortcuts((action, event) => {
    if (action === "history-back" || action === "history-forward") {
      event.preventDefault();
      setSession((s) => moveInHistory(s, action === "history-back" ? -1 : 1));
      return;
    }
    const rank = tabRankOf(action);
    if (rank === null) return;
    event.preventDefault();
    setTabsState((s) => activateTabAt(s, rank));
  });

  // Palette : « Fichier précédent » et « Fichier suivant », seulement quand le geste agit.
  // `t` : relu au changement de langue.
  const { t } = useTranslation("shortcuts");
  useCommand(
    canMove(session, -1)
      ? {
          id: "history-back",
          label: shortcutLabel("history-back"),
          group: t("groups.tabs"),
          shortcut: "history-back",
          run: () => setSession((s) => moveInHistory(s, -1)),
        }
      : null,
  );
  useCommand(
    canMove(session, 1)
      ? {
          id: "history-forward",
          label: shortcutLabel("history-forward"),
          group: t("groups.tabs"),
          shortcut: "history-forward",
          run: () => setSession((s) => moveInHistory(s, 1)),
        }
      : null,
  );

  // Session du dossier affiché : enregistrée à chaque changement, jamais pendant le
  // rétablissement ni sans propriétaire (accueil).
  const { owner, restoring, recent } = session;
  useEffect(() => {
    if (owner === null || restoring) return;
    writeStoredSession(owner, sessionOf(tabsState, recent));
  }, [owner, restoring, tabsState, recent]);

  // ⌘W est l'entrée « Fermer l'onglet » du menu de l'app (src-tauri/src/menu.rs) : le menu
  // prend le raccourci avant la page et prévient le front par cet événement.
  // ⌘S (« Enregistrer », événement `save-file`) : l'onglet actif, s'il a des modifications.
  // « Quitter » et la fermeture de la fenêtre avec des modifications ou un processus en cours
  // dans le terminal : `quit-requested` (menu.rs, `must_confirm_quit`).
  const onMenu = useEffectEvent((event: "close-tab" | "save-file" | "quit-requested") => {
    if (event === "close-tab") {
      // Focus dans le terminal : ⌘W ferme sa page (`TerminalProvider`), pas l'onglet de fichier.
      // Focus dans la page du navigateur : ⌘W ferme son onglet (`BrowserProvider`).
      if (isInTerminal(document.activeElement) || isInBrowserPage()) return;
      if (activeTab) requestCloseTab(activeTab.path);
    } else if (event === "save-file") {
      if (activeTab?.dirty) void saveDocument(tabKey(activeTab), activeTab.path);
    } else {
      // Rust a vu des modifications ou un processus en cours : la boîte mentionne les deux.
      const count = dirtyCount;
      void runningCommands().then((running) => {
        const text = quitConfirmation(count, running);
        if (text === null) void commands.quitApp();
        else setUnsavedRequest({ kind: "quit", text });
      });
    }
  });
  useEffect(() => {
    const names = ["close-tab", "save-file", "quit-requested"] as const;
    const unlisten = names.map((name) => listen(name, () => onMenu(name)));
    return () => {
      for (const off of unlisten) void off.then((stop) => stop());
    };
  }, []);

  // Glisser-déposer : le premier dossier déposé est ouvert, les fichiers sont ignorés.
  // Avec des modifications non enregistrées, la boîte passe avant l'ouverture.
  const dragging = useFolderDrop((paths) =>
    confirmLeavingFolder(() => {
      void (async () => {
        for (const path of paths) {
          const err = await tryOpen(path);
          if (!err) return;
          if (err.kind !== "NotADirectory") {
            setError(openErrorMessage(err));
            return;
          }
        }
        setError(i18n.t("app:folders.errors.notADirectory"));
      })();
    }),
  );

  // Ouvert depuis le Finder avant le lancement du front : la cible passe avant le dernier
  // dossier (spec ouvrir-depuis-finder.md). Échec d'ouverture : message de ⌘O, puis le dernier
  // dossier s'affiche comme d'habitude.
  // Une seule fois (la lecture vide la file de Rust) : le garde `launchHandled` tient aussi
  // en mode strict de React, qui exécute l'effet deux fois.
  // Lien ou CLI hors du dernier dossier (spec ouvrir-depuis-terminal.md) : lancement habituel,
  // puis la boîte de confirmation. D'où l'attente du dernier dossier.
  const lastRootPending = lastRoot.isPending;
  const lastRootPath = lastRoot.data?.path ?? null;
  useEffect(() => {
    if (launchHandled.current || lastRootPending) return;
    launchHandled.current = true;
    void (async () => {
      // Le dernier dossier s'affiche (pas de cible, lien à confirmer, échec) : sa session
      // revient. Sans l'attendre : l'app s'affiche aussitôt, un fichier ouvert entre-temps
      // l'emporte (spec continuite.md).
      let lastRootShown = true;
      try {
        const result = await commands.takeOpenedPaths(null);
        const target = result.status === "ok" ? result.data : null;
        if (target === null) return;
        const plan = planOpen(target, lastRootPath);
        if (plan.kind === "confirmRoot") {
          setLinkPlan(plan);
          return;
        }
        const err = await tryOpen(target.root);
        if (err) setError(openErrorMessage(err));
        else {
          lastRootShown = false;
          setTabsState((s) => openEntries(s, target.files, target.line ?? undefined));
        }
      } finally {
        if (lastRootShown && lastRootPath !== null) void restoreSession(lastRootPath);
        setLaunchSettled(true);
      }
    })();
  }, [tryOpen, restoreSession, setTabsState, lastRootPending, lastRootPath]);

  // Ouvert depuis le Finder, un lien ou la CLI alors que l'app tourne : Rust prévient
  // (`PathsOpened`), le front lit la file. Même dossier racine : onglets épinglés (à la ligne) ;
  // autre dossier : comme ⌘O, après « Ouvrir le dossier … ? » pour un lien.
  const onPathsOpened = useEffectEvent(async () => {
    const current = root?.path ?? null;
    const result = await commands.takeOpenedPaths(current);
    if (result.status === "error") {
      setError(openErrorMessage(result.error));
      return;
    }
    const plan = planOpen(result.data, current);
    if (plan.kind === "sameRoot") setTabsState((s) => openEntries(s, plan.files, plan.line));
    else if (plan.kind === "otherRoot") openPlanRoot(plan);
    else if (plan.kind === "confirmRoot") setLinkPlan(plan);
  });
  useEffect(() => {
    const unlisten = events.pathsOpened.listen(() => void onPathsOpened());
    return () => void unlisten.then((stop) => stop());
  }, []);

  // Au lancement, rien tant que le dernier dossier et la cible du Finder ne sont pas connus
  // (pas d'accueil ni de dernier dossier fugaces).
  if (chosenRoot === undefined && (lastRoot.isPending || !launchSettled)) return null;

  return (
    <WorkspaceActionsContext value={actions}>
      <WorkspaceContext value={workspace}>
        <RecentFilesContext value={recent}>{children}</RecentFilesContext>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {notice && <Notice message={notice} onDone={() => setNotice(null)} />}
        {unsavedRequest?.kind === "close" && (
          <SaveChangesDialog
            name={unsavedRequest.tab.name}
            onSave={() => void saveAndClose(unsavedRequest.tab)}
            onDiscard={() => {
              setUnsavedRequest(null);
              setTabsState((s) => closeTab(s, unsavedRequest.tab.path));
            }}
            onCancel={() => setUnsavedRequest(null)}
          />
        )}
        {unsavedRequest?.kind === "quit" && (
          <StopDialog
            text={unsavedRequest.text}
            onConfirm={() => {
              setUnsavedRequest(null);
              void commands.quitApp();
            }}
            onCancel={() => setUnsavedRequest(null)}
          />
        )}
        {(unsavedRequest?.kind === "others" || unsavedRequest?.kind === "folder") && (
          <UnsavedChangesDialog
            count={unsavedRequest.count}
            confirmLabel={i18n.t("app:workspace.closeWithoutSaving")}
            onConfirm={() => {
              setUnsavedRequest(null);
              if (unsavedRequest.kind === "folder") unsavedRequest.proceed();
              else setTabsState((s) => closeOtherTabs(s, unsavedRequest.path));
            }}
            onCancel={() => setUnsavedRequest(null)}
          />
        )}
        {linkPlan && (
          <OpenLinkDialog
            root={linkPlan.root}
            onConfirm={() => {
              setLinkPlan(null);
              openPlanRoot(linkPlan);
            }}
            onCancel={() => setLinkPlan(null)}
          />
        )}
        {trashTarget && (
          <TrashDialog
            target={trashTarget}
            unsaved={dirtyTabsUnder(tabsState.tabs, trashTarget.path).length > 0}
            onCancel={() => setTrashTarget(null)}
            onConfirm={(target) => void confirmTrash(target)}
          />
        )}
        {dragging && <DropOverlay />}
      </WorkspaceContext>
    </WorkspaceActionsContext>
  );
}
