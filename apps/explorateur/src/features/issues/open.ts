// Ouvrir une issue depuis une référence (`#123`, lien `…/issues/123`) : docs/specs/issues-github.md,
// lot 3. L'issue est lue avant l'ouverture : une pull request s'ouvre dans le navigateur.
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBrowserActions } from "@/features/browser/context";
import { useWorkspaceActions } from "@/features/workspace/context";
import { issueQuery, repoQuery } from "./api";
import i18n from "@/i18n";
import { issueTabName, panelError, unavailableMessage } from "./model";
import {
  isPullRequestError,
  isPullRequestUrl,
  parseIssueUrl,
  pullRequestUrl,
  sameRepoIssueNumber,
} from "./refs";

function browse(url: string) {
  void openUrl(url).catch(() => {});
}

/** Message d'une erreur de lecture du dépôt ou de l'issue. */
function failureText(error: unknown): string {
  const failure = panelError(error);
  return "reason" in failure ? unavailableMessage(failure.reason) : i18n.t("issues:readFailed");
}

/**
 * Gestes qui ouvrent une issue du dépôt du dossier racine `root` (passé à chaque appel : le
 * terminal garde le sien à jour). `openIssue` : onglet épinglé, ou navigateur pour une pull
 * request. `openLink` : lien web du terminal, en onglet s'il désigne une issue du même dépôt,
 * sinon dans le navigateur intégré.
 */
export function useIssueOpener() {
  const queryClient = useQueryClient();
  const browser = useBrowserActions();
  const { openIssueTab, notify, showError } = useWorkspaceActions();

  const openIssue = useCallback(
    async (root: string, number: number) => {
      let repo;
      try {
        repo = await queryClient.fetchQuery(repoQuery(root));
      } catch (error) {
        showError(failureText(error));
        return;
      }
      const query = issueQuery(root, number);
      // Déjà lue il y a moins d'une minute : ouverture immédiate, sans message.
      if (queryClient.getQueryData(query.queryKey) === undefined) {
        notify(i18n.t("issues:opener.reading", { number }));
      }
      try {
        const issue = await queryClient.fetchQuery(query);
        if (isPullRequestUrl(issue.url)) {
          browse(pullRequestUrl(repo.url, number));
          return;
        }
        openIssueTab(repo.nameWithOwner, number, issueTabName(number, issue.title), issue.state, {
          pin: true,
        });
      } catch (error) {
        if (isPullRequestError(error)) {
          browse(pullRequestUrl(repo.url, number));
          return;
        }
        // Introuvable, hors ligne : l'onglet affiche lui-même l'erreur, avec « Réessayer ».
        openIssueTab(repo.nameWithOwner, number, `#${number}`, "OPEN", { pin: true });
      }
    },
    [queryClient, openIssueTab, notify, showError],
  );

  const openLink = useCallback(
    async (root: string | null, url: string) => {
      if (root !== null && parseIssueUrl(url) !== null) {
        try {
          const repo = await queryClient.fetchQuery(repoQuery(root));
          const number = sameRepoIssueNumber(url, repo.nameWithOwner);
          if (number !== null) {
            await openIssue(root, number);
            return;
          }
        } catch {
          // Dépôt GitHub inconnu : c'est un lien comme un autre.
        }
      }
      // Lien web du terminal : onglet du navigateur intégré (spec navigateur.md).
      browser.openUrl(url);
    },
    [queryClient, openIssue, browser],
  );

  return { openIssue, openLink };
}
