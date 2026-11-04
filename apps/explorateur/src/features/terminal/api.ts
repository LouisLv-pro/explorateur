// Appels Rust du terminal (décision 0006) : une session par page, sortie en octets bruts par un
// `Channel`. Pas de TanStack Query pour le flux ; seul l'état des processus en cours est sondé.
import { useQuery } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  events,
  type AppError,
  type FileLink,
  type RunningTerminal,
  type TerminalOutput,
} from "@/bindings";

/**
 * Le canal reçoit un `ArrayBuffer` (corps brut de Rust) ; le type généré dit `number[]`, car
 * specta ne connaît pas `InvokeResponseBody` (voir `TerminalOutput` dans `commands/terminal.rs`).
 */
function toBytes(data: TerminalOutput | ArrayBuffer): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
}

/** Lance le shell de la page `id` ; renvoie l'erreur de démarrage, `null` si tout va bien. */
export async function startTerminal(
  id: number,
  cwd: string,
  size: { cols: number; rows: number },
  onBytes: (bytes: Uint8Array) => void,
): Promise<AppError | null> {
  const channel = new Channel<TerminalOutput>();
  channel.onmessage = (data) => onBytes(toBytes(data));
  const result = await commands.startTerminal(id, cwd, size.cols, size.rows, channel);
  return result.status === "error" ? result.error : null;
}

/** Saisie de l'utilisateur vers le shell. Une page déjà fermée côté Rust est ignorée. */
export function writeTerminal(id: number, data: string): void {
  void commands.writeTerminal(id, data);
}

export function resizeTerminal(id: number, cols: number, rows: number): void {
  void commands.resizeTerminal(id, cols, rows);
}

/** Termine le shell de la page et ses processus (raccroché, arrêt forcé après 2 s). */
export function closeTerminal(id: number): void {
  void commands.closeTerminal(id);
}

/** Sondage des processus en cours, panneau affiché (icône de chargement des onglets). */
const RUNNING_POLL_MS = 1000;

/** Pages ayant un processus en cours, par identifiant ; sondé seulement si `enabled`. */
export function useRunningTerminals(enabled: boolean): ReadonlyMap<number, string> {
  const { data } = useQuery({
    queryKey: ["running_terminals"],
    queryFn: () => commands.runningTerminals(),
    enabled,
    refetchInterval: enabled ? RUNNING_POLL_MS : false,
    select: byId,
  });
  return data ?? NO_RUNNING;
}
const NO_RUNNING: ReadonlyMap<number, string> = new Map();
// Fonction stable : TanStack Query ne refait la `Map` que si la liste a changé (partage
// structurel), donc pas de rendu à chaque sondage.
const byId = (running: RunningTerminal[]) => new Map(running.map((r) => [r.id, r.command]));

/** Commande en cours dans la page `id`, demandée à Rust au moment du geste. */
export async function runningCommandOf(id: number): Promise<string | null> {
  const running = await commands.runningTerminals();
  return running.find((r) => r.id === id)?.command ?? null;
}

/** Commandes en cours de toutes les pages, sans doublon (confirmation de sortie). */
export function runningCommands(): Promise<string[]> {
  return commands.runningCommands().catch(() => []);
}

/** Liens fichier d'une ligne ; aucun en cas d'erreur. */
export async function findFileLinks(line: string, cwd: string, root: string): Promise<FileLink[]> {
  const result = await commands.findTerminalLinks(line, cwd, root);
  return result.status === "ok" ? result.data : [];
}

/** Chemin échappé pour le shell, par Rust (seule source de vérité de la règle). */
export function shellQuote(path: string): Promise<string> {
  return commands.shellQuote(path);
}

/** Écoute la fin des shells (`exit`, `⌃D`) ; renvoie la fonction qui arrête l'écoute. */
export function onTerminalExited(listener: (id: number) => void): () => void {
  const unlisten = events.terminalExited.listen((event) => listener(event.payload.id));
  return () => void unlisten.then((stop) => stop());
}
