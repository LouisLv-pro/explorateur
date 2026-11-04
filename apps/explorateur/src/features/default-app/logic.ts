// Logique pure du dialogue « app par défaut » (docs/specs/app-par-defaut.md) : quels groupes
// cocher, quels types demander, ce qui s'est passé. L'état et les appels sont dans le composant.
import type { Group, GroupStatus, PendingType } from "@/bindings";

/** Tous les types du groupe sont déjà à explorateur. */
export function isGroupDone(status: GroupStatus): boolean {
  return status.pending.length === 0;
}

/** Au premier affichage, tous les groupes incomplets sont cochés. */
export function initialChecked(statuses: readonly GroupStatus[]): Set<Group> {
  return new Set(statuses.filter((s) => !isGroupDone(s)).map((s) => s.group));
}

/**
 * Les types à demander à macOS : ceux en attente des groupes cochés, dans l'ordre de la table,
 * sans doublon (un type partagé par deux groupes ne demande qu'une confirmation).
 */
export function requestsFor(
  statuses: readonly GroupStatus[],
  checked: ReadonlySet<Group>,
): PendingType[] {
  const seen = new Set<string>();
  const requests: PendingType[] = [];
  for (const status of statuses) {
    if (!checked.has(status.group)) continue;
    for (const type of status.pending) {
      if (seen.has(type.uti)) continue;
      seen.add(type.uti);
      requests.push(type);
    }
  }
  return requests;
}

/**
 * Bilan des types demandés, d'après l'état relu : un type encore en attente est un refus,
 * les autres sont acceptés.
 */
export function summarize(
  attempted: readonly PendingType[],
  after: readonly GroupStatus[],
): { accepted: number; refused: PendingType[] } {
  const stillPending = new Set(after.flatMap((s) => s.pending.map((p) => p.uti)));
  const refused = attempted.filter((type) => stillPending.has(type.uti));
  return { accepted: attempted.length - refused.length, refused };
}

/** Extensions affichées telles quelles, avec un point : `.md, .markdown`. */
export function extensionsLabel(extensions: readonly string[]): string {
  return extensions.map((ext) => `.${ext}`).join(", ");
}
