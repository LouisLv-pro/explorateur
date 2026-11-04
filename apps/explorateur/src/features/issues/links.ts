// Lien GitHub des lignes d'un fichier et corps d'une issue créée depuis le code (spec
// issues-github.md, lot 3). Fonctions pures.
import type { RemoteState } from "@/bindings";
import i18n from "@/i18n";

/**
 * Texte français de l'avertissement, gardé pour `links.test.ts` (il lit la constante comme une
 * valeur). L'avertissement affiché vient de `issues:linkWarning`, dans la langue active.
 */
export const LINK_WARNING = "Les lignes peuvent différer sur GitHub (modifications non poussées).";

/**
 * `<url du dépôt>/blob/<hash de HEAD>/<chemin>#L10-L20` (`#L10` pour une ligne). Le chemin est
 * encodé segment par segment (espaces, accents, `#`, `?`, `%`), les `/` restent.
 */
export function githubFileLink({
  repoUrl,
  head,
  repoPath,
  start,
  end,
}: {
  repoUrl: string;
  head: string;
  /** Chemin depuis la racine du dépôt git, séparé par `/`. */
  repoPath: string;
  /** Première et dernière lignes (à partir de 1) : dans n'importe quel ordre. */
  start: number;
  end: number;
}): string {
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  const path = repoPath.split("/").map(encodeURIComponent).join("/");
  const lines = first === last ? `#L${first}` : `#L${first}-L${last}`;
  return `${repoUrl.replace(/\/+$/, "")}/blob/${head}/${path}${lines}`;
}

/**
 * Avertissement du lien : le fichier a des modifications (disque ou éditeur), ou HEAD n'est pas
 * poussé (`↑` non nul, branche sans amont). Un état distant inconnu ou sans geste réseau compte
 * comme non poussé, par prudence. `null` : le lien vaut sur GitHub.
 */
export function linkWarning({
  modified,
  remote,
}: {
  modified: boolean;
  remote: RemoteState | undefined;
}): string | null {
  if (modified || remote?.kind !== "upstream" || remote.ahead > 0) {
    return i18n.t("issues:linkWarning");
  }
  return null;
}

/** Clôture d'un bloc de code Markdown : plus longue que toute suite d'accents graves du code. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Corps d'une issue créée depuis le code : le lien des lignes, puis ces lignes en bloc de code.
 * Des lignes toutes vides (curseur sur une ligne vide) ne donnent que le lien.
 */
export function issueBodyFromSelection({
  link,
  language,
  code,
}: {
  link: string;
  /** Langage du fichier (`rust`, `typescript`…), `null` : bloc sans langage. */
  language: string | null;
  code: string;
}): string {
  if (code.trim() === "") return link;
  const fence = fenceFor(code);
  return `${link}\n\n${fence}${language ?? ""}\n${code}\n${fence}`;
}
