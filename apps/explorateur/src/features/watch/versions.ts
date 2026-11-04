import { useSyncExternalStore } from "react";

// Nombre de changements vus sur le disque, par chemin de fichier. Sert aux aperçus que TanStack
// Query ne relit pas (image, PDF, page HTML) : leur URL ou leur clé change avec ce numéro.
const versions = new Map<string, number>();
const listeners = new Set<() => void>();

/** Note un lot de fichiers changés et prévient les aperçus abonnés. */
export function recordChanges(files: readonly string[]) {
  for (const file of files) versions.set(file, (versions.get(file) ?? 0) + 1);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Version de `path` : 0 tant qu'il n'a pas changé. */
export function useFileVersion(path: string): number {
  return useSyncExternalStore(subscribe, () => versions.get(path) ?? 0);
}

/** Somme des versions des fichiers de `dir` et en dessous : change dès que l'un d'eux change. */
export function versionUnder(dir: string): number {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  let sum = 0;
  for (const [path, version] of versions) if (path.startsWith(prefix)) sum += version;
  return sum;
}

export function useVersionUnder(dir: string): number {
  return useSyncExternalStore(subscribe, () => versionUnder(dir));
}
