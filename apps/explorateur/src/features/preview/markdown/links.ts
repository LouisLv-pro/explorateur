/** Cible d'un lien relatif résolu : chemin absolu et ancre (décodée, sans `#`). */
export type ResolvedLink = { path: string; hash: string };

export type LinkKind = "external" | "anchor" | "file" | "other";

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Résout `link` depuis le dossier de `file` (chemin absolu). Gère `./`, `../`, l'ancre et les
 * caractères encodés (`%20`). `null` si le lien remonte au-dessus de `/`.
 */
export function resolveRelative(file: string, link: string): ResolvedLink | null {
  const hashAt = link.indexOf("#");
  const rawPath = hashAt < 0 ? link : link.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : decode(link.slice(hashAt + 1));
  const target = decode(rawPath.split("?")[0] ?? "");
  if (target === "") return { path: file, hash };

  const segments = target.startsWith("/") ? [] : file.split("/").filter(Boolean).slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return { path: `/${segments.join("/")}`, hash };
}

/** `path` est `root` lui-même ou se trouve dessous. */
export function isInside(path: string, root: string): boolean {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return path === base || path.startsWith(`${base}/`);
}

/** Classe un lien : navigateur ou mail, ancre du document, fichier du disque, ou autre schéma. */
export function classifyLink(href: string): LinkKind {
  if (/^(https?|mailto):/i.test(href)) return "external";
  if (href.startsWith("#")) return "anchor";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "other";
  return "file";
}

/** Identifiant d'un titre, comme GitHub : minuscules, ponctuation retirée, espaces en `-`. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}
