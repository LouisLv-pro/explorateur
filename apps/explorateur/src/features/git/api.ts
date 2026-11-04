// Appels Rust du volet Modifications (décision 0007) : statut et diffs par TanStack Query,
// gestes du lot 2 (indexer, désindexer, annuler, committer) suivis d'une relecture.
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commands,
  type AppError,
  type CommitOptions,
  type DiffLine,
  type FileChange,
  type GitSnapshot,
  type GutterBlock,
  type Hunk,
} from "@/bindings";
import { normalizeLineBreaks } from "@/features/editor/lineBreak";
import { unwrap } from "@/lib/ipc";
import { relativePath } from "@/lib/paths";
import type { GitMarks } from "./context";
import { NO_MARKS, snapshotMarks } from "./marks";

/** Sondage du statut, volet affiché : un `git add` fait dans le terminal se voit en 2 s. */
const STATUS_POLL_MS = 2000;

export const gitStatusKey = (root: string) => ["git_status", root] as const;
export const gitDiffRootKey = (root: string) => ["git_diff", root] as const;
/** Sous la clé du statut : relu avec lui (commit fait dans le terminal compris). */
const lastMessageKey = (root: string) => [...gitStatusKey(root), "last-message"] as const;

/** Texte indexé d'un fichier : sous la clé du statut, relu avec lui. */
export const gitIndexTextRootKey = (root: string) => [...gitStatusKey(root), "index"] as const;

/**
 * Une seule réponse (`GitSnapshot`) porte le statut et les repères : le cache garde la réponse
 * entière sous `gitStatusKey`, chaque lecteur en prend sa moitié par `select`.
 */
const selectStatus = (snapshot: GitSnapshot) => snapshot.status;

function useGitSnapshot<T>(
  root: string,
  polling: boolean,
  enabled: boolean,
  select: (snapshot: GitSnapshot) => T,
) {
  return useQuery({
    queryKey: gitStatusKey(root),
    queryFn: async () => unwrap(await commands.getGitStatus(root)),
    refetchInterval: polling ? STATUS_POLL_MS : false,
    enabled,
    // Un sondage en erreur ne doit pas répéter trois fois l'appel.
    retry: false,
    select,
  });
}

/** Statut du dépôt du dossier racine ; sondé toutes les 2 s si `polling` (volet affiché). */
export function useGitStatus(root: string, polling: boolean, enabled = true) {
  return useGitSnapshot(root, polling, enabled, selectStatus);
}

/**
 * Repères de l'arborescence et des onglets (`GitProvider`, un seul lecteur) : lus dans la
 * réponse du statut (aucune seconde requête), vides hors dépôt.
 */
export function useGitMarks(root: string | null, polling: boolean): GitMarks {
  const { data } = useGitSnapshot(root ?? "", polling, root !== null, selectMarks);
  return data ?? NO_GIT_MARKS;
}

const NO_GIT_MARKS: GitMarks = { inRepo: false, marks: NO_MARKS };

const marksOfSnapshot = new WeakMap<GitSnapshot, GitMarks>();

/** `inRepo` et repères d'une réponse, un objet par réponse (les lecteurs ne rendent pas à vide). */
function selectMarks(snapshot: GitSnapshot): GitMarks {
  let marks = marksOfSnapshot.get(snapshot);
  if (!marks) {
    const inRepo = snapshot.status.kind === "repo";
    marks = inRepo ? { inRepo, marks: snapshotMarks(snapshot) } : NO_GIT_MARKS;
    marksOfSnapshot.set(snapshot, marks);
  }
  return marks;
}

/**
 * Texte indexé du fichier `path` (absolu), base de la gouttière, en fins de ligne `\n` comme
 * l'éditeur. `null` : non suivi, conflit, binaire, hors dépôt (`inRepo` faux) ou pas encore lu.
 */
export function useIndexText(root: string | null, path: string, inRepo: boolean): string | null {
  const rel = root === null ? path : relativePath(path, root);
  const { data } = useQuery({
    queryKey: [...gitIndexTextRootKey(root ?? ""), rel],
    queryFn: async () => unwrap(await commands.getGitIndexText(root ?? "", rel)),
    enabled: inRepo && root !== null && rel !== path,
    retry: false,
    select: selectIndexText,
  });
  return inRepo ? (data ?? null) : null;
}

const selectIndexText = (text: string | null) => (text === null ? null : normalizeLineBreaks(text));

/** Blocs de la gouttière (demandés à chaque frappe, après un délai, sans cache). */
export async function fetchGutterBlocks(
  indexText: string,
  editorText: string,
): Promise<GutterBlock[]> {
  return unwrap(await commands.getGitGutterBlocks(indexText, editorText));
}

/** Diff d'une modification, lu seulement si `enabled` (diff approché et déplié). */
export function useGitDiff(root: string, change: FileChange, enabled: boolean) {
  return useQuery({
    queryKey: [
      ...gitDiffRootKey(root),
      change.staged,
      change.repoPath,
      change.origRepoPath,
      change.status,
    ],
    queryFn: async () => unwrap(await commands.getGitDiff(root, change)),
    enabled,
    retry: false,
  });
}

/** Lignes masquées avant le bloc `gap` (ou après le dernier), demandées au clic. */
export async function fetchHiddenLines(
  root: string,
  change: FileChange,
  gap: number,
): Promise<DiffLine[]> {
  return unwrap(await commands.getGitHiddenLines(root, change, gap));
}

/** Message du dernier commit (`null` sans commit), pour « Modifier le dernier commit ». */
export function useLastCommitMessage(root: string, enabled: boolean) {
  return useQuery({
    queryKey: lastMessageKey(root),
    queryFn: async () => unwrap(await commands.gitLastCommitMessage(root)),
    enabled,
    retry: false,
  });
}

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/**
 * Gestes git du volet. Chacun lève l'`AppError` de Rust en cas d'échec ; réussi ou non, le
 * statut et les diffs sont relus ensuite.
 */
export function useGitActions(root: string) {
  const queryClient = useQueryClient();
  return useMemo(() => {
    async function run<T>(call: () => Promise<Result<T>>): Promise<T> {
      try {
        return unwrap(await call());
      } finally {
        void queryClient.invalidateQueries({ queryKey: gitStatusKey(root) });
        void queryClient.invalidateQueries({ queryKey: gitDiffRootKey(root) });
      }
    }
    return {
      stageFile: (change: FileChange) => run(() => commands.gitStageFile(root, change)),
      unstageFile: (change: FileChange) => run(() => commands.gitUnstageFile(root, change)),
      stageAll: () => run(() => commands.gitStageAll(root)),
      unstageAll: () => run(() => commands.gitUnstageAll(root)),
      stageHunk: (change: FileChange, hunk: Hunk) =>
        run(() => commands.gitStageHunk(root, change, hunk)),
      unstageHunk: (change: FileChange, hunk: Hunk) =>
        run(() => commands.gitUnstageHunk(root, change, hunk)),
      discardFile: (change: FileChange) => run(() => commands.gitDiscardFile(root, change)),
      discardHunk: (change: FileChange, hunk: Hunk) =>
        run(() => commands.gitDiscardHunk(root, change, hunk)),
      commit: (message: string, options: CommitOptions) =>
        run(() => commands.gitCommit(root, message, options)),
    };
  }, [queryClient, root]);
}

export type GitActions = ReturnType<typeof useGitActions>;
