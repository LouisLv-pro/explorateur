// Branche distante (docs/specs/git-distant.md) : état sondé avec le statut, gestes réseau
// (récupérer, pousser, publier, tirer) et récupération automatique. Un seul geste à la fois.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { commands, type RemoteState } from "@/bindings";
import { useWorkspace } from "@/features/workspace/context";
import { unwrap } from "@/lib/ipc";
import { gitDiffRootKey, gitStatusKey, useGitStatus } from "./api";
import type { RemoteSync } from "./context";
import {
  autoFetchFailure,
  hasRemote,
  pulledText,
  pushedText,
  remoteErrorText,
  shouldAutoFetch,
  type AutoTrigger,
  type NetworkGesture,
} from "./remote";

/** Sondage de l'état distant, volet affiché : comme le statut (aucun réseau). */
const REMOTE_POLL_MS = 2000;
/** Le minuteur vérifie l'âge de la dernière récupération chaque minute. */
const TICK_MS = 60_000;

/** Sous la clé du statut : relu avec lui (changement disque, focus, gestes du volet). */
const remoteStateKey = (root: string) => [...gitStatusKey(root), "remote"] as const;

/** Ce que la session garde du dossier racine courant (remis à zéro à son changement). */
type Session = {
  root: string | null;
  lastFetch: number | null;
  /** Une récupération automatique a échoué : arrêt jusqu'à un geste manuel réussi. */
  stopped: boolean;
  autoError: Failure | null;
  error: Failure | null;
};

/**
 * Échec gardé tel quel (erreur et état distant d'alors) : le texte se compose au rendu, dans la
 * langue active, pour que le changement de langue le mette à jour.
 */
type Failure = { error: unknown; state: RemoteState | undefined };

const emptySession = (root: string | null): Session => ({
  root,
  lastFetch: null,
  stopped: false,
  autoError: null,
  error: null,
});

export function useRemoteGestures(rootPath: string | null, open: boolean): RemoteSync {
  // Redessine au changement de langue : les messages d'erreur sont composés au rendu.
  useTranslation("git");
  const { notify } = useWorkspace();
  const queryClient = useQueryClient();
  const status = useGitStatus(rootPath ?? "", open, rootPath !== null);
  const inRepo = rootPath !== null && status.data?.kind === "repo";
  const { data: state } = useQuery({
    queryKey: remoteStateKey(rootPath ?? ""),
    queryFn: async () => unwrap(await commands.getGitRemoteState(rootPath ?? "")),
    enabled: inRepo,
    refetchInterval: open ? REMOTE_POLL_MS : false,
    retry: false,
  });
  const shownState = inRepo ? state : undefined;

  const [busy, setBusy] = useState<NetworkGesture | null>(null);
  const [stored, setStored] = useState<Session>(() => emptySession(rootPath));
  const session = stored.root === rootPath ? stored : emptySession(rootPath);
  const busyRef = useRef<NetworkGesture | null>(null);
  const stateRef = useRef<RemoteState | undefined>(undefined);
  useLayoutEffect(() => {
    stateRef.current = shownState;
  });

  const patch = useCallback((root: string, change: Partial<Session>) => {
    setStored((current) => ({
      ...(current.root === root ? current : emptySession(root)),
      ...change,
    }));
  }, []);

  const settle = useCallback(
    (root: string) => {
      busyRef.current = null;
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: gitStatusKey(root) });
      void queryClient.invalidateQueries({ queryKey: gitDiffRootKey(root) });
    },
    [queryClient],
  );

  const fetch = useCallback(
    async (auto: boolean) => {
      if (rootPath === null || busyRef.current !== null) return;
      busyRef.current = "fetch";
      setBusy("fetch");
      if (!auto) patch(rootPath, { error: null });
      try {
        unwrap(await commands.gitFetch(rootPath));
        patch(rootPath, {
          lastFetch: Date.now(),
          ...(auto ? {} : { stopped: false, autoError: null }),
        });
      } catch (failure) {
        const failed: Failure = { error: failure, state: stateRef.current };
        if (auto) patch(rootPath, { stopped: true, autoError: failed });
        else patch(rootPath, { error: failed });
      } finally {
        settle(rootPath);
      }
    },
    [rootPath, patch, settle],
  );

  const push = useCallback(async (): Promise<boolean> => {
    if (rootPath === null || busyRef.current !== null) return false;
    busyRef.current = "push";
    setBusy("push");
    patch(rootPath, { error: null });
    const before = stateRef.current;
    try {
      unwrap(await commands.gitPush(rootPath));
      patch(rootPath, { stopped: false, autoError: null });
      notify(pushedText(before));
      return true;
    } catch (failure) {
      patch(rootPath, { error: { error: failure, state: before } });
      return false;
    } finally {
      settle(rootPath);
    }
  }, [rootPath, patch, settle, notify]);

  const pull = useCallback(async () => {
    if (rootPath === null || busyRef.current !== null) return;
    busyRef.current = "pull";
    setBusy("pull");
    patch(rootPath, { error: null });
    const before = stateRef.current;
    try {
      const count = unwrap(await commands.gitPull(rootPath));
      patch(rootPath, { stopped: false, autoError: null });
      notify(pulledText(count, before));
    } catch (failure) {
      patch(rootPath, { error: { error: failure, state: before } });
    } finally {
      settle(rootPath);
    }
  }, [rootPath, patch, settle, notify]);

  // Récupération automatique : ouverture du volet, retour du focus, minuteur.
  const remoteKnown = hasRemote(shownState);
  const tryAuto = useEffectEvent((trigger: AutoTrigger) => {
    const allowed = shouldAutoFetch(trigger, {
      hasRemote: remoteKnown,
      running: busyRef.current !== null,
      stopped: session.stopped,
      lastFetch: session.lastFetch,
      now: Date.now(),
      windowFocused: document.hasFocus(),
    });
    if (allowed) void fetch(true);
  });
  useEffect(() => {
    if (open && remoteKnown) tryAuto("open");
  }, [open, remoteKnown, rootPath]);
  useEffect(() => {
    const onFocus = () => tryAuto("focus");
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => tryAuto("tick"), TICK_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);

  const dismissError = useCallback(() => {
    if (rootPath !== null) patch(rootPath, { error: null });
  }, [rootPath, patch]);

  // Textes composés à chaque rendu, dans la langue active (le hook s'abonne à la langue).
  const autoError = session.autoError && autoFetchFailure(session.autoError.error);
  const error = session.error && remoteErrorText(session.error.error, session.error.state);

  return useMemo(
    () => ({
      state: shownState,
      busy,
      lastFetch: session.lastFetch,
      autoError,
      error,
      dismissError,
      fetch: () => void fetch(false),
      push,
      pull: () => void pull(),
    }),
    [shownState, busy, session.lastFetch, autoError, error, dismissError, fetch, push, pull],
  );
}
