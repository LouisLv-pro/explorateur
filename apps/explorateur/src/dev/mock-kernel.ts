// Faux environnements Python et faux noyau Jupyter du navigateur simulé (docs/specs/notebook.md,
// « Navigateur simulé »). Le noyau répète le code de la cellule dans un `stream` ; `raise` donne
// une erreur, `sleep` reste « Occupé » jusqu'à « Interrompre ». Comme ipykernel, les cellules
// déjà envoyées après une erreur ou une interruption sont annulées (`Aborted`).
import type { AppError, KernelEvent, PythonEnv } from "@/bindings";
import { NOTEBOOKS_ROOT } from "./mock-disk";

type Channel = { onmessage: (event: KernelEvent) => void };
type Job = { cellId: string; code: string };
type FakeKernel = {
  channel: Channel;
  queue: Job[];
  /** Cellule en cours (un `sleep` y reste jusqu'à l'interruption). */
  current: Job | null;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const kernels = new Map<string, FakeKernel>();
let nextId = 1;
/**
 * Aucun Python avec ipykernel (bandeau d'installation) : `?nopython` dans l'adresse, ou
 * `window.__mockKernel.noPython()`. L'état tient au rechargement (`sessionStorage`) et il est relu
 * à chaque `list_python_envs`.
 */
const NO_PYTHON_KEY = "explorateur.mock.noPython";

function pythonFound(): boolean {
  if (typeof window === "undefined") return true;
  if (new URLSearchParams(window.location.search).has("nopython")) return false;
  return window.sessionStorage.getItem(NO_PYTHON_KEY) === null;
}

const STEP_MS = 150;

/** En-tête d'une pile IPython : nom de l'exception, puis le titre aligné sur 75 colonnes. */
function tracebackHeader(ename: string): string[] {
  const title = "Traceback (most recent call last)";
  const gap = " ".repeat(Math.max(1, 75 - ename.length - title.length));
  return [`\u001b[31m${"-".repeat(75)}\u001b[39m`, `\u001b[31m${ename}\u001b[39m${gap}${title}`];
}

/** Ligne de la cellule fautive : une seule entrée, qui contient elle-même des `\n`. */
function cellFrame(count: number, line: string): string {
  return (
    `\u001b[36mCell\u001b[39m\u001b[36m \u001b[39m\u001b[32mIn[${count}]\u001b[39m\u001b[32m, line 1\u001b[39m\n` +
    `\u001b[32m----> \u001b[39m\u001b[32m1\u001b[39m ${line}\n`
  );
}

function send(kernel: FakeKernel, event: KernelEvent) {
  kernel.channel.onmessage(event);
}

function kernelOf(args: Record<string, unknown>): FakeKernel {
  const id = args.kernelId as string;
  const kernel = kernels.get(id);
  if (!kernel) throw { kind: "KernelNotFound" } satisfies AppError;
  return kernel;
}

/** Fin de la cellule en cours : les suivantes déjà envoyées sont annulées après un échec. */
function finish(kernel: FakeKernel, job: Job, failed: boolean) {
  send(kernel, { type: "executionFinished", cellId: job.cellId, status: failed ? "Error" : "Ok" });
  kernel.current = null;
  if (failed) {
    for (const aborted of kernel.queue.splice(0)) {
      send(kernel, { type: "executionFinished", cellId: aborted.cellId, status: "Aborted" });
    }
  }
  pump(kernel);
}

function pump(kernel: FakeKernel) {
  if (kernel.current) return;
  const job = kernel.queue.shift();
  if (!job) {
    send(kernel, { type: "status", state: "Idle" });
    return;
  }
  kernel.current = job;
  kernel.count += 1;
  send(kernel, { type: "status", state: "Busy" });
  send(kernel, { type: "executionStarted", cellId: job.cellId, executionCount: kernel.count });
  // `sleep` : attend « Interrompre ».
  if (job.code.includes("sleep")) return;
  kernel.timer = setTimeout(() => {
    kernel.timer = null;
    if (job.code.includes("raise")) {
      send(kernel, {
        type: "output",
        cellId: job.cellId,
        output: {
          output_type: "error",
          ename: "Exception",
          evalue: "erreur simulée",
          // Format d'ipykernel (IPython 9) : entrées à joindre par `\n`.
          traceback: [
            ...tracebackHeader("Exception"),
            cellFrame(kernel.count, job.code.split("\n")[0] ?? ""),
            "\u001b[31mException\u001b[39m: erreur simulée",
          ],
        },
      });
      finish(kernel, job, true);
      return;
    }
    send(kernel, {
      type: "output",
      cellId: job.cellId,
      output: { output_type: "stream", name: "stdout", text: `${job.code}\n` },
    });
    finish(kernel, job, false);
  }, STEP_MS);
}

export const kernelHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_python_envs: (args): PythonEnv[] => {
    const path = args.path as string;
    const envs: PythonEnv[] = [
      {
        id: "shell:/usr/bin/python3",
        label: "python3 (shell)",
        kind: "Shell",
        hasIpykernel: false,
      },
    ];
    if (pythonFound() && path.startsWith(`${NOTEBOOKS_ROOT}/`)) {
      envs.unshift({
        id: `venv:${NOTEBOOKS_ROOT}/.venv/bin/python`,
        label: ".venv (projet)",
        kind: "Venv",
        hasIpykernel: true,
      });
    }
    return envs;
  },
  start_kernel: async (args) => {
    if (!(args.envId as string).startsWith("venv:")) {
      throw { kind: "NoPythonEnv" } satisfies AppError;
    }
    const channel = args.channel as Channel;
    channel.onmessage({ type: "status", state: "Starting" });
    // Le vrai noyau met un moment à répondre.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const id = `fake-kernel-${nextId++}`;
    const kernel: FakeKernel = { channel, queue: [], current: null, count: 0, timer: null };
    kernels.set(id, kernel);
    send(kernel, { type: "status", state: "Idle" });
    return id;
  },
  execute_cell: (args) => {
    const kernel = kernelOf(args);
    kernel.queue.push({ cellId: args.cellId as string, code: args.code as string });
    pump(kernel);
    return null;
  },
  interrupt_kernel: (args) => {
    const kernel = kernelOf(args);
    const job = kernel.current;
    if (!job) return null;
    if (kernel.timer) clearTimeout(kernel.timer);
    kernel.timer = null;
    send(kernel, {
      type: "output",
      cellId: job.cellId,
      output: {
        output_type: "error",
        ename: "KeyboardInterrupt",
        evalue: "",
        traceback: [
          ...tracebackHeader("KeyboardInterrupt"),
          cellFrame(kernel.count, job.code.split("\n")[0] ?? ""),
          "\u001b[31mKeyboardInterrupt\u001b[39m: ",
        ],
      },
    });
    finish(kernel, job, true);
    return null;
  },
  restart_kernel: (args) => {
    const kernel = kernelOf(args);
    if (kernel.timer) clearTimeout(kernel.timer);
    kernel.timer = null;
    kernel.queue = [];
    kernel.current = null;
    kernel.count = 0;
    send(kernel, { type: "status", state: "Starting" });
    setTimeout(() => send(kernel, { type: "status", state: "Idle" }), 300);
    return null;
  },
  shutdown_kernel: (args) => {
    const kernel = kernelOf(args);
    if (kernel.timer) clearTimeout(kernel.timer);
    kernels.delete(args.kernelId as string);
    return null;
  },
};

/**
 * Outils de la console : `window.__mockKernel.noPython()`, `python()`, `die()`. Les deux premiers
 * tiennent au rechargement ; la liste est relue au prochain geste (sélecteur, « Rechercher à
 * nouveau », premier « Exécuter »).
 */
export const kernelTools = {
  noPython: () => {
    window.sessionStorage.setItem(NO_PYTHON_KEY, "1");
  },
  python: () => {
    window.sessionStorage.removeItem(NO_PYTHON_KEY);
  },
  /** Arrêt brutal de tous les noyaux (bannière « Le noyau s'est arrêté. »). */
  die: () => {
    for (const [id, kernel] of kernels) {
      if (kernel.timer) clearTimeout(kernel.timer);
      send(kernel, { type: "died", message: "Simulated crash" });
      kernels.delete(id);
    }
  },
};
