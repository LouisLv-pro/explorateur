// Appels Rust des issues GitHub (décision 0010) : dépôt, liste et issue par TanStack Query.
// Chaque lecture lance `gh` (réseau compris) : jamais en arrière-plan, seulement vue ou onglet
// affichés (`<Activity>` désabonne les requêtes des vues masquées).
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { commands, type AppError, type IssueFilter, type NewIssue } from "@/bindings";
import { isAppError, unwrap } from "@/lib/ipc";

/** Au plus une relecture au retour du focus par minute. */
export const REFETCH_MIN_MS = 60_000;

/** Préfixe commun de toutes les lectures GitHub d'un dossier racine (invalidation en bloc). */
export const githubKey = (root: string) => ["github", root] as const;
const repoKey = (root: string) => [...githubKey(root), "repo"] as const;
export const issuesKey = (root: string, filter: IssueFilter) =>
  [...githubKey(root), "issues", filter] as const;
export const issueKey = (root: string, number: number) =>
  [...githubKey(root), "issue", number] as const;

/** Lecture du dépôt GitHub du dossier racine : options partagées par la vue, les liens et le terminal. */
export const repoQuery = (root: string) =>
  queryOptions({
    queryKey: repoKey(root),
    queryFn: async () => unwrap(await commands.getGithubRepo(root)),
    // Pas de nouvelle tentative : l'erreur est un état affiché (« Réessayer »).
    retry: false,
    // Le dépôt ne change pas pendant la session : relu à l'affichage d'un état d'erreur seulement.
    staleTime: (query) => (query.state.status === "error" ? 0 : Infinity),
  });

/** Dépôt GitHub du dossier racine, ou la raison pour laquelle il n'y en a pas (`error`). */
export function useGithubRepo(root: string) {
  return useQuery(repoQuery(root));
}

/**
 * Dépôt GitHub du dossier racine pour les liens `#123` d'un texte (aperçu Markdown) : lu une
 * fois, seulement si `enabled` (le texte contient de quoi lier), sans relance au focus ni à
 * chaque affichage quand `gh` échoue. `undefined` tant qu'il est inconnu ou indisponible.
 */
export function useLinkRepo(root: string, enabled: boolean) {
  return useQuery({
    ...repoQuery(root),
    enabled,
    refetchOnWindowFocus: false,
    retryOnMount: false,
  }).data;
}

/** Ce que git sait d'un fichier pour son lien GitHub (relatif au dossier racine). */
export const fileLinkInfoQuery = (root: string, path: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["git", "file-link", root, path] as const,
    queryFn: async () => unwrap(await commands.getGitFileLinkInfo(root, path)),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

/**
 * Liste du filtre. `repoReady` : le dépôt est connu. Relue à chaque affichage de la vue
 * (`staleTime` 0) ; le retour du focus est géré par le panneau (au plus une fois par minute).
 */
export function useIssueList(root: string, filter: IssueFilter, repoReady: boolean) {
  return useQuery({
    queryKey: issuesKey(root, filter),
    queryFn: async () => unwrap(await commands.listGithubIssues(root, filter)),
    enabled: repoReady,
    retry: false,
    refetchOnWindowFocus: false,
    // L'ancienne liste reste affichée pendant la lecture.
    placeholderData: keepPreviousData,
  });
}

/** Lecture d'une issue : options partagées par l'onglet et son icône (même `queryFn`). */
export const issueQuery = (root: string, number: number) =>
  queryOptions({
    queryKey: issueKey(root, number),
    queryFn: async () => unwrap(await commands.getGithubIssue(root, number)),
    retry: false,
    // Relue à l'activation de l'onglet et au focus, au plus une fois par minute.
    staleTime: REFETCH_MIN_MS,
  });

/** Une issue de l'onglet. */
export function useIssue(root: string, number: number) {
  return useQuery(issueQuery(root, number));
}

// ---------- Création (lot 2) ----------

/** Les listes du dialogue (labels, assignables, utilisateur) restent valables 5 min. */
const PICKER_STALE_MS = 5 * 60_000;

/** Labels du dépôt, lus à l'ouverture du dialogue. */
export function useLabels(root: string) {
  return useQuery({
    queryKey: [...githubKey(root), "labels"] as const,
    queryFn: async () => unwrap(await commands.listGithubLabels(root)),
    retry: false,
    staleTime: PICKER_STALE_MS,
  });
}

/** Personnes assignables du dépôt. */
export function useAssignees(root: string) {
  return useQuery({
    queryKey: [...githubKey(root), "assignees"] as const,
    queryFn: async () => unwrap(await commands.listGithubAssignees(root)),
    retry: false,
    staleTime: PICKER_STALE_MS,
  });
}

/** Login de l'utilisateur de `gh` (« M'assigner »). */
export function useCurrentUser(root: string) {
  return useQuery({
    queryKey: [...githubKey(root), "user"] as const,
    queryFn: async () => unwrap(await commands.getGithubUser(root)),
    retry: false,
    staleTime: PICKER_STALE_MS,
  });
}

/** Modèles d'issue du dépôt, relus sur le disque à chaque ouverture du dialogue. */
export function useIssueTemplates(root: string) {
  return useQuery({
    queryKey: [...githubKey(root), "templates"] as const,
    queryFn: async () => unwrap(await commands.listIssueTemplates(root)),
    retry: false,
    staleTime: 0,
  });
}

/** Crée l'issue et rend son numéro ; la liste des issues est relue après une création. */
export function useCreateIssue(root: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (issue: NewIssue) => unwrap(await commands.createGithubIssue(root, issue)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...githubKey(root), "issues"] as const }),
  });
}

/** Relit tout ce que GitHub a donné (après une connexion dans le terminal, « Réessayer »). */
export function useResetGithub(root: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: githubKey(root) });
}

/** L'erreur d'une requête comme `AppError`, `null` si ce n'en est pas une. */
export function asAppError(error: unknown): AppError | null {
  return isAppError(error) ? error : null;
}
