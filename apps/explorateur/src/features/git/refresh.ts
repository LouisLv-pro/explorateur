// Relecture git sur un changement disque (docs/specs/gros-depots.md) : un lot d'écritures dans
// un dossier ignoré ou dans un gros dossier non suivi (build Xcode) ne change rien au statut.
import type { GitSnapshot } from "@/bindings";
import { relativePath } from "@/lib/paths";
import { isIgnored, isUnderFolded, snapshotMarks } from "./marks";

/**
 * Un lot de chemins (absolus) touchés sous `root` justifie-t-il de relire le statut ? Oui s'il
 * contient un chemin ni ignoré, ni sous un dossier non suivi replié, d'après le dernier statut
 * lu. Sans statut lu (`snapshot` absent), toujours : on ne sait pas ce qui est ignoré. Un chemin
 * hors du dossier racine relit (il ne devrait pas arriver). Dossier racine dans un dossier non
 * suivi replié : tout est non suivi, rien ne relit.
 */
export function shouldRefreshGit(
  paths: readonly string[],
  root: string,
  snapshot: GitSnapshot | undefined,
): boolean {
  if (snapshot === undefined) return true;
  const index = snapshotMarks(snapshot);
  return paths.some((path) => {
    const rel = relativePath(path, root);
    if (rel === path) return true;
    if (index.rootUntracked) return false;
    return !isIgnored(index, rel) && !isUnderFolded(index, rel);
  });
}
