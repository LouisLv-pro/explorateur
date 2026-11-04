// Dialogue « Définir comme app par défaut » (docs/specs/app-par-defaut.md). macOS demande une
// confirmation par type de fichier : le dialogue les annonce, les demande une par une, montre où
// l'on en est et relit l'état à la fin. Le calcul est dans `logic.ts`.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type AppError,
  type Group,
  type GroupStatus,
  type PendingType,
} from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { appErrorMessage } from "@/i18n/errors";
import { extensionsLabel, initialChecked, isGroupDone, requestsFor, summarize } from "./logic";

type State =
  | { phase: "loading" }
  | { phase: "error"; error: AppError }
  | { phase: "choice"; statuses: GroupStatus[]; checked: Set<Group> }
  | { phase: "running"; requests: PendingType[]; index: number; stopping: boolean }
  | { phase: "done"; attempted: PendingType[]; total: number; after: GroupStatus[] };

const LOADING: State = { phase: "loading" };

export function DefaultAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("defaultApp");
  const [state, setState] = useState<State>(LOADING);
  const [wasOpen, setWasOpen] = useState(open);
  // « Arrêter » : lu entre deux demandes, la fenêtre de macOS déjà ouverte reste à répondre.
  const stopped = useRef(false);

  // À chaque ouverture, repartir de l'état de macOS (état relu, pas celui d'une session passée).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setState(LOADING);
  }

  useEffect(() => {
    if (!open) return;
    stopped.current = false;
    let cancelled = false;
    void commands.defaultAppStatus().then((result) => {
      if (cancelled) return;
      if (result.status === "error") setState({ phase: "error", error: result.error });
      else {
        setState({
          phase: "choice",
          statuses: result.data,
          checked: initialChecked(result.data),
        });
      }
    });
    return () => {
      cancelled = true;
      stopped.current = true;
    };
  }, [open]);

  function toggle(group: Group, on: boolean) {
    setState((current) => {
      if (current.phase !== "choice") return current;
      const checked = new Set(current.checked);
      if (on) checked.add(group);
      else checked.delete(group);
      return { ...current, checked };
    });
  }

  async function run(requests: PendingType[]) {
    const attempted: PendingType[] = [];
    for (const [index, type] of requests.entries()) {
      if (stopped.current) break;
      setState({ phase: "running", requests, index, stopping: false });
      try {
        // Le résultat vient de la relecture finale : un refus ou une erreur comptent pareil.
        await commands.setDefaultApp(type.uti);
      } catch {
        // Une erreur d'une demande compte comme un refus, la suite continue.
      }
      attempted.push(type);
    }
    const result = await commands.defaultAppStatus();
    if (result.status === "error") setState({ phase: "error", error: result.error });
    else {
      setState({ phase: "done", attempted, total: requests.length, after: result.data });
    }
  }

  function stop() {
    stopped.current = true;
    setState((current) => (current.phase === "running" ? { ...current, stopping: true } : current));
  }

  // Échap et la croix pendant les demandes valent « Arrêter » : le dialogue reste jusqu'au bilan.
  function handleOpenChange(next: boolean) {
    if (!next && state.phase === "running") stop();
    else onOpenChange(next);
  }

  const closeButton = (
    <Button variant="outline" onClick={() => onOpenChange(false)}>
      {t("close")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        {state.phase === "loading" && <p className="text-body-sm text-mute">{t("loading")}</p>}
        {state.phase === "error" && (
          <>
            <p className="text-body-sm text-body">{appErrorMessage(state.error)}</p>
            <div className="flex justify-end">{closeButton}</div>
          </>
        )}
        {state.phase === "choice" && (
          <Choice
            statuses={state.statuses}
            checked={state.checked}
            onToggle={toggle}
            onAsk={(requests) => void run(requests)}
            closeButton={closeButton}
          />
        )}
        {state.phase === "running" && (
          <>
            <div className="grid gap-2">
              <p className="text-body-sm text-ink">
                {t("progress", {
                  current: state.index + 1,
                  total: state.requests.length,
                  extensions: extensionsLabel(state.requests[state.index]?.extensions ?? []),
                })}
              </p>
              <Progress value={(state.index / state.requests.length) * 100} />
              {state.stopping && <p className="text-caption text-mute">{t("stopping")}</p>}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={state.stopping} onClick={stop}>
                {t("stop")}
              </Button>
            </div>
          </>
        )}
        {state.phase === "done" && <Outcome state={state} closeButton={closeButton} />}
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  statuses,
  checked,
  onToggle,
  onAsk,
  closeButton,
}: {
  statuses: GroupStatus[];
  checked: Set<Group>;
  onToggle: (group: Group, on: boolean) => void;
  onAsk: (requests: PendingType[]) => void;
  closeButton: React.ReactNode;
}) {
  const { t } = useTranslation("defaultApp");
  if (statuses.every(isGroupDone)) {
    return (
      <>
        <p className="text-body-sm text-body">{t("allDone")}</p>
        <div className="flex justify-end">{closeButton}</div>
      </>
    );
  }
  const requests = requestsFor(statuses, checked);
  return (
    <>
      <div className="grid gap-1">
        {statuses.map((status) => {
          const done = isGroupDone(status);
          return (
            <label
              key={status.group}
              className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-canvas-soft"
            >
              <Checkbox
                className="mt-0.5"
                checked={done || checked.has(status.group)}
                disabled={done}
                onCheckedChange={(on) => onToggle(status.group, on === true)}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-body-sm text-ink">{t(`groups.${status.group}`)}</span>
                <span className="font-mono text-caption-mono break-words text-mute">
                  {extensionsLabel(status.extensions)}
                </span>
              </span>
              <span className="shrink-0 text-caption text-mute">
                {done
                  ? t("status.done")
                  : status.defaultTypes > 0
                    ? t("status.partial", { count: status.defaultTypes, total: status.types })
                    : t("status.types", { count: status.types })}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {closeButton}
        <Button disabled={requests.length === 0} onClick={() => onAsk(requests)}>
          {t("ask", { total: requests.length })}
        </Button>
      </div>
    </>
  );
}

function Outcome({
  state,
  closeButton,
}: {
  state: Extract<State, { phase: "done" }>;
  closeButton: React.ReactNode;
}) {
  const { t } = useTranslation("defaultApp");
  const { accepted, refused } = summarize(state.attempted, state.after);
  const stopped = state.attempted.length < state.total;
  return (
    <>
      <div className="grid gap-1">
        <p className="text-body-sm text-ink">
          {t("result.summary", {
            accepted: t("result.accepted", { count: accepted }),
            refused: t("result.refused", { count: refused.length }),
          })}
        </p>
        {stopped && (
          <p className="text-body-sm text-body">
            {t("result.stopped", { done: state.attempted.length, total: state.total })}
          </p>
        )}
        {refused.length > 0 && (
          <p className="font-mono text-caption-mono break-words text-mute">
            {t("result.refusedList", {
              extensions: extensionsLabel(refused.flatMap((type) => type.extensions)),
            })}
          </p>
        )}
      </div>
      <div className="flex justify-end">{closeButton}</div>
    </>
  );
}
