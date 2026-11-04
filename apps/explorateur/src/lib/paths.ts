/** Abrège le dossier personnel en `~` (`/Users/alex/Projets` → `~/Projets`). */
export function tildify(path: string, home: string | undefined): string {
  if (!home) return path;
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === base) return "~";
  if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`;
  return path;
}

/**
 * URL du protocole `preview` (décision 0001) pour le fichier absolu `path` : un segment par
 * dossier, pour qu'une page HTML résolve ses liens relatifs (`style.css`, `img/a.png`) depuis
 * son propre dossier. `convertFileSrc` encoderait tout le chemin en un seul segment (`%2F`).
 * `base` : `convertFileSrc("", "preview")`, soit `preview://localhost/` sur macOS.
 */
export function previewUrl(base: string, path: string): string {
  const segments = path.replace(/^\/+/, "").split("/").map(encodeURIComponent);
  return `${base.endsWith("/") ? base : `${base}/`}${segments.join("/")}`;
}

/** Dossier parent d'un chemin absolu (`/a/b.md` → `/a`, `/a` → `/`). */
export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** Dernier segment d'un chemin (`/a/b.md` → `b.md`). */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Chemin de `path` relatif au dossier `root` (sans `/` initial). */
export function relativePath(path: string, root: string): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}
