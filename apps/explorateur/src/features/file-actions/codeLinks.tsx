// Gestes « depuis le code » du menu Actions et du menu d'onglet (spec issues-github.md, lot 3) :
// « Créer une issue depuis la sélection » et « Copier le lien GitHub ». Ils lisent la sélection
// de l'éditeur (ligne du curseur sans sélection) et fabriquent le lien GitHub des lignes.
//
// Actifs si : la source du fichier est affichée dans l'éditeur (mode Source ou Scindé d'un
// Markdown ou HTML, fichier texte), le fichier existe dans HEAD (un fichier non suivi ou
// seulement indexé n'est pas sur GitHub), et le dossier racine est dans un dépôt GitHub que
// `gh` connaît. Montés à l'ouverture du menu seulement : aucune requête git ou `gh` avant.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import i18n from "@/i18n";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { getDocument, getSelectedLines, isDirty } from "@/features/editor/documents";
import { fileLinkInfoQuery, repoQuery } from "@/features/issues/api";
import { useNewIssue } from "@/features/issues/composer";
import { githubFileLink, issueBodyFromSelection, linkWarning } from "@/features/issues/links";
import { languageFor } from "@/features/preview/languages";
import { tabKey } from "@/features/tabs/tabs";
import { useWorkspace } from "@/features/workspace/context";
import { baseName, relativePath } from "@/lib/paths";
import type { FileAction } from "./actions";

/** Les deux gestes pour `path`, désactivés tant qu'ils ne peuvent pas aboutir. */
export function useCodeLinkActions(path: string): FileAction[] {
  // Abonne le composant à la langue : les libellés sont traduits à chaque rendu.
  useTranslation("files");
  const { root, tabs, notify, showError } = useWorkspace();
  const rootPath = root?.path ?? "";
  const relative = relativePath(path, rootPath);
  const tab = tabs.find((t) => t.path === path);
  const key = tab ? tabKey(tab) : null;
  const openNewIssue = useNewIssue();

  const enabled = root !== null && key !== null;
  const repo = useQuery({ ...repoQuery(rootPath), enabled });
  const info = useQuery(fileLinkInfoQuery(rootPath, relative, enabled));

  const ready =
    key !== null &&
    getSelectedLines(key) !== null &&
    repo.isSuccess &&
    info.isSuccess &&
    info.data !== null &&
    info.data.tracked &&
    info.data.head !== null;

  /** Lien, avertissement et lignes au moment du geste (sélection, HEAD et distant relus). */
  async function resolve() {
    const repoInfo = repo.data;
    const lines = key === null ? null : getSelectedLines(key);
    if (!repoInfo || !lines || key === null) {
      showError(i18n.t("files:codeLinks.noSelection"));
      return null;
    }
    const [linkInfo, remote] = await Promise.all([
      commands.getGitFileLinkInfo(rootPath, relative),
      commands.getGitRemoteState(rootPath),
    ]);
    if (linkInfo.status === "error" || linkInfo.data === null || linkInfo.data.head === null) {
      showError(i18n.t("files:codeLinks.linkFailed"));
      return null;
    }
    if (!linkInfo.data.tracked) {
      showError(i18n.t("files:codeLinks.notCommitted"));
      return null;
    }
    const link = githubFileLink({
      repoUrl: repoInfo.url,
      head: linkInfo.data.head,
      repoPath: linkInfo.data.repoPath,
      start: lines.start,
      end: lines.end,
    });
    const warning = linkWarning({
      modified: linkInfo.data.modified || isDirty(getDocument(key)),
      remote: remote.status === "ok" ? remote.data : undefined,
    });
    return { link, warning, lines, repoName: repoInfo.nameWithOwner };
  }

  return [
    {
      id: "issue-from-selection",
      label: i18n.t("files:codeLinks.createIssue"),
      disabled: !ready,
      run: () =>
        void resolve().then((found) => {
          if (!found) return;
          openNewIssue({
            repoName: found.repoName,
            append: issueBodyFromSelection({
              link: found.link,
              language: languageFor(baseName(path)),
              code: found.lines.text,
            }),
            notice: found.warning,
          });
        }),
    },
    {
      id: "copy-github-link",
      label: i18n.t("files:codeLinks.copyLink"),
      disabled: !ready,
      run: () =>
        void resolve().then(async (found) => {
          if (!found) return;
          try {
            await navigator.clipboard.writeText(found.link);
            notify(
              found.warning
                ? i18n.t("files:codeLinks.copiedWithWarning", { warning: found.warning })
                : i18n.t("files:codeLinks.copied"),
            );
          } catch {
            showError(i18n.t("common:copyFailed"));
          }
        }),
    },
  ];
}

/** Entrées du menu contextuel d'onglet. */
export function CodeLinkContextItems({ path }: { path: string }) {
  return useCodeLinkActions(path).map((action) => (
    <ContextMenuItem key={action.id} disabled={action.disabled} onSelect={action.run}>
      {action.label}
    </ContextMenuItem>
  ));
}

/** Entrées du menu déroulant « Actions ». */
export function CodeLinkDropdownItems({ path }: { path: string }) {
  return useCodeLinkActions(path).map((action) => (
    <DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={action.run}>
      {action.label}
    </DropdownMenuItem>
  ));
}
