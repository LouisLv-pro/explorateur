// « Se connecter dans le terminal » : page de terminal titrée « gh auth login » où la commande
// est tapée (même mécanique que les serveurs locaux). La vue se relit quand la page revient au
// prompt, est fermée, ou n'a jamais montré de processus (commande échouée tout de suite).
import { useEffect, useEffectEvent } from "react";
import { useRunningTerminals } from "@/features/terminal/api";
import { useTerminalView } from "@/features/terminal/context";

/** Sans processus vu après ce délai, la commande a échoué tout de suite. */
const START_GRACE_MS = 8000;

/** Suivi d'une connexion lancée : monté seulement pendant la connexion. */
export type LoginRun = { pageId: number; seen: boolean; startedAt: number };

export function GhLoginWatcher({
  run,
  onSeen,
  onFinished,
}: {
  run: LoginRun;
  /** Le processus `gh` a été vu en cours. */
  onSeen: () => void;
  /** Page revenue au prompt, fermée ou commande échouée : relire GitHub. */
  onFinished: () => void;
}) {
  const { pages } = useTerminalView();
  const running = useRunningTerminals(true);
  const pageOpen = pages.some((p) => p.id === run.pageId);
  const isRunning = running.has(run.pageId);

  useEffect(() => {
    if (!pageOpen) onFinished();
    else if (isRunning && !run.seen) onSeen();
    else if (!isRunning && run.seen) onFinished();
  }, [pageOpen, isRunning, run.seen, onSeen, onFinished]);

  const onGrace = useEffectEvent(() => {
    if (!run.seen && !isRunning && Date.now() - run.startedAt > START_GRACE_MS) onFinished();
  });
  useEffect(() => {
    if (run.seen) return;
    const timer = setInterval(() => onGrace(), 1000);
    return () => clearInterval(timer);
  }, [run.seen]);

  return null;
}
