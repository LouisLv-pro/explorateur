// Noyau Jupyter de chaque notebook ouvert (docs/specs/notebook.md) : un par onglet (clé
// `tabKey`), démarré au premier « Exécuter », jamais à l'ouverture. Comme les documents, l'état
// vit hors de React : il survit au masquage de l'onglet (`<Activity>`).
import { useSyncExternalStore } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type AppError, type KernelEvent, type KernelState } from "@/bindings";
import { editNotebook, notebookOf } from "@/features/editor/documents";
import { cellSource, cellType, type NotebookModel } from "./model";
import { applyKernelEvent, changesFile } from "./outputs";

export type KernelStatus = "none" | "starting" | "idle" | "busy" | "dead";

export type KernelSession = {
  status: KernelStatus;
  kernelId: string | null;
  /** Message de `died` : bannière « Le noyau s'est arrêté. ». */
  died: string | null;
  /** Échec d'une commande (démarrage, envoi) : affiché dans la barre d'outils. */
  error: AppError | null;
  /** Change à chaque démarrage ou arrêt : les événements d'un ancien noyau sont ignorés. */
  generation: number;
};

const NONE: KernelSession = {
  status: "none",
  kernelId: null,
  died: null,
  error: null,
  generation: 0,
};

const sessions = new Map<string, KernelSession>();
const listeners = new Set<() => void>();
/** Démarrages en cours : une exécution demandée pendant ce temps attend le même noyau. */
const starting = new Map<string, Promise<string | null>>();
/** Environnement choisi pour chaque notebook (chemin), gardé pendant la session de l'app. */
const envChoices = new Map<string, string>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function get(docKey: string): KernelSession {
  return sessions.get(docKey) ?? NONE;
}

function set(docKey: string, patch: Partial<KernelSession>) {
  sessions.set(docKey, { ...get(docKey), ...patch });
  notify();
}

/** Noyau de l'onglet `docKey`, relu à chaque changement. */
export function useKernel(docKey: string): KernelSession {
  return useSyncExternalStore(subscribe, () => get(docKey));
}

export function chosenEnv(path: string): string | undefined {
  return envChoices.get(path);
}

/** Change l'environnement du notebook : le noyau en cours est arrêté. */
export function chooseEnv(docKey: string, path: string, envId: string) {
  if (envChoices.get(path) === envId) return;
  envChoices.set(path, envId);
  shutdownKernel(docKey);
}

const STATUS: Record<KernelState, KernelStatus> = {
  Starting: "starting",
  Idle: "idle",
  Busy: "busy",
  Dead: "dead",
};

/** Cellules `keys` marquées en cours ou non (état de session : l'onglet ne devient pas modifié). */
function markRunning(docKey: string, keys: Set<string> | "all", running: boolean) {
  editNotebook(
    docKey,
    (model) => {
      let changed = false;
      const cells = model.cells.map((cell) => {
        const concerned = keys === "all" ? cell.running : keys.has(cell.key);
        if (!concerned || Boolean(cell.running) === running) return cell;
        changed = true;
        return { ...cell, running };
      });
      return changed ? { ...model, cells } : model;
    },
    { dirty: false },
  );
}

/** Noyau mort : les cellules en cours repassent à `[ ]`. */
function resetRunning(model: NotebookModel): NotebookModel {
  if (!model.cells.some((c) => c.running)) return model;
  return {
    ...model,
    cells: model.cells.map((cell) =>
      cell.running
        ? { ...cell, running: false, json: { ...cell.json, execution_count: null } }
        : cell,
    ),
  };
}

function onEvent(docKey: string, event: KernelEvent) {
  switch (event.type) {
    case "status":
      set(docKey, { status: STATUS[event.state] });
      return;
    case "died":
      set(docKey, { status: "dead", died: event.message, kernelId: null });
      editNotebook(docKey, resetRunning);
      return;
    default:
      editNotebook(docKey, (model) => applyKernelEvent(model, event), {
        dirty: changesFile(event),
      });
  }
}

/** Noyau de l'onglet, démarré s'il n'y en a pas ; `null` si le démarrage échoue. */
function ensureKernel(docKey: string, path: string, envId: string): Promise<string | null> {
  const session = get(docKey);
  if (session.kernelId) return Promise.resolve(session.kernelId);
  const pending = starting.get(docKey);
  if (pending) return pending;

  const generation = session.generation + 1;
  set(docKey, { status: "starting", generation, died: null, error: null });
  const channel = new Channel<KernelEvent>();
  channel.onmessage = (event) => {
    if (get(docKey).generation === generation) onEvent(docKey, event);
  };
  const promise: Promise<string | null> = commands
    .startKernel(path, envId, channel)
    .then((result) => {
      if (starting.get(docKey) === promise) starting.delete(docKey);
      if (get(docKey).generation !== generation) {
        // Arrêté (onglet fermé, autre environnement) pendant le démarrage.
        if (result.status === "ok") void commands.shutdownKernel(result.data);
        return null;
      }
      if (result.status === "error") {
        set(docKey, { status: "none", error: result.error });
        return null;
      }
      const status = get(docKey).status;
      set(docKey, { kernelId: result.data, status: status === "starting" ? "idle" : status });
      return result.data;
    });
  starting.set(docKey, promise);
  return promise;
}

/**
 * Exécute les cellules de code `keys`, dans l'ordre, sans attendre les réponses : après une
 * erreur, le noyau répond `Aborted` aux suivantes. Le code est lu au moment du geste.
 */
export async function runCells(docKey: string, path: string, envId: string, keys: string[]) {
  const parsed = notebookOf(docKey);
  if (!parsed?.ok) return;
  const wanted = new Set(keys);
  const jobs = parsed.model.cells
    .filter((cell) => wanted.has(cell.key) && cellType(cell) === "code")
    .map((cell) => ({ key: cell.key, code: cellSource(cell) }));
  if (jobs.length === 0) return;
  markRunning(docKey, new Set(jobs.map((j) => j.key)), true);

  const kernelId = await ensureKernel(docKey, path, envId);
  if (!kernelId) {
    markRunning(docKey, "all", false);
    return;
  }
  // Un envoi après l'autre : l'ordre d'arrivée au noyau est celui des cellules.
  for (const { key, code } of jobs) {
    const result = await commands.executeCell(kernelId, key, code);
    if (result.status === "error") {
      set(docKey, { error: result.error });
      markRunning(docKey, new Set([key]), false);
    }
  }
}

export async function interruptKernel(docKey: string) {
  const { kernelId } = get(docKey);
  if (!kernelId) return;
  const result = await commands.interruptKernel(kernelId);
  if (result.status === "error") set(docKey, { error: result.error });
}

/** « Redémarrer » : variables vidées. Un noyau mort est remplacé par un neuf. */
export async function restartKernel(docKey: string, path: string, envId: string) {
  const { kernelId, status } = get(docKey);
  markRunning(docKey, "all", false);
  if (kernelId && status !== "dead") {
    set(docKey, { error: null });
    const result = await commands.restartKernel(kernelId);
    if (result.status === "error") set(docKey, { error: result.error });
    return;
  }
  shutdownKernel(docKey);
  await ensureKernel(docKey, path, envId);
}

/** Arrête le noyau de l'onglet (fermeture, autre environnement). Déjà arrêté : rien à signaler. */
export function shutdownKernel(docKey: string) {
  const session = get(docKey);
  if (session.status === "none" && !session.kernelId && !starting.has(docKey)) return;
  starting.delete(docKey);
  set(docKey, { ...NONE, generation: session.generation + 1 });
  markRunning(docKey, "all", false);
  // `KernelNotFound` (noyau déjà arrêté par Rust au changement de racine) est ignoré.
  if (session.kernelId) void commands.shutdownKernel(session.kernelId);
}

/** Arrête les noyaux des onglets fermés (à côté de `pruneDocuments`). */
export function pruneNotebookKernels(keys: Set<string>) {
  for (const docKey of [...sessions.keys()]) {
    if (keys.has(docKey)) continue;
    shutdownKernel(docKey);
    sessions.delete(docKey);
  }
}
