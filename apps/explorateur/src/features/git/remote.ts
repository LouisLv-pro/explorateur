// Fonctions pures de la branche distante (docs/specs/git-distant.md, décision 0010) : bouton de
// synchronisation, infobulles, messages d'erreur, planification de la récupération automatique.
import type { RemoteErrorKind, RemoteState } from "@/bindings";
import i18n from "@/i18n";
import { relativeTime } from "@/i18n/format";
import { appErrorText, isAppError } from "@/lib/ipc";

/** Retour du focus : récupération seulement si la dernière date de plus de 2 min. */
export const FOCUS_STALE_MS = 2 * 60_000;
/** Fenêtre active : une récupération toutes les 5 min. */
export const AUTO_INTERVAL_MS = 5 * 60_000;

/** Geste réseau en cours (un seul à la fois). */
export type NetworkGesture = "fetch" | "push" | "pull";

/** Le dépôt a un remote utilisable par la récupération automatique (amont ou publiable). */
export function hasRemote(state: RemoteState | undefined): boolean {
  return state?.kind === "upstream" || state?.kind === "publishable";
}

/** Nom du remote d'un état (`origin` pour l'amont `origin/main`), `null` sans geste possible. */
export function remoteName(state: RemoteState | undefined): string | null {
  if (state?.kind === "upstream") return state.name.split("/")[0] ?? null;
  if (state?.kind === "publishable") return state.remote;
  return null;
}

/** Texte `↑A ↓B` (chaque nombre masqué à 0) ; vide si rien à afficher. */
export function countsText(state: RemoteState | undefined): string {
  if (state?.kind !== "upstream") return "";
  return [state.ahead > 0 ? `↑${state.ahead}` : "", state.behind > 0 ? `↓${state.behind}` : ""]
    .filter((part) => part !== "")
    .join(" ");
}

/** « récupéré il y a 3 min » ; « pas encore récupéré » avant la première récupération. */
export function fetchedText(lastFetch: number | null, now: number): string {
  if (lastFetch === null) return i18n.t("git:remote.fetched.never");
  const minutes = Math.floor((now - lastFetch) / 60_000);
  if (minutes < 1) return i18n.t("git:remote.fetched.now");
  const time =
    minutes < 60 ? relativeTime(minutes, "minute") : relativeTime(Math.floor(minutes / 60), "hour");
  return i18n.t("git:remote.fetched.ago", { time });
}

/** Infobulle de `↑A ↓B` : « 2 commits à pousser, 1 à tirer vers origin/main · récupéré il y a 3 min ». */
export function remoteTooltip(
  state: RemoteState | undefined,
  lastFetch: number | null,
  now: number,
): string {
  if (state?.kind !== "upstream") return "";
  const { ahead, behind, name } = state;
  const commits = (count: number) => i18n.t("git:remote.commits", { count });
  let summary: string;
  if (ahead > 0 && behind > 0) {
    summary = i18n.t("git:remote.tooltip.both", { ahead: commits(ahead), behind, name });
  } else if (ahead > 0) {
    summary = i18n.t("git:remote.tooltip.ahead", { ahead: commits(ahead), name });
  } else if (behind > 0) {
    summary = i18n.t("git:remote.tooltip.behind", { behind: commits(behind), name });
  } else {
    summary = i18n.t("git:remote.tooltip.synced", { name });
  }
  return `${summary} · ${fetchedText(lastFetch, now)}`;
}

/** Message de l'infobulle quand une récupération automatique a échoué. */
export function autoFetchFailure(error: unknown): string {
  return i18n.t("git:remote.fetchFailed", { detail: firstLine(errorOutput(error)) });
}

/** Bouton de synchronisation de l'en-tête du volet. */
export type SyncButton = {
  action: "fetch" | "push" | "pull" | "publish" | "none";
  label: string;
  icon: "refresh-cw" | "arrow-up" | "arrow-down" | "cloud-upload";
  /** Libellé visible (sinon icône seule). */
  showLabel: boolean;
  disabled: boolean;
  /** Raison affichée en infobulle quand le bouton est désactivé. */
  reason: string | null;
};

/** Bouton selon l'état distant ; `null` sans geste réseau (HEAD détaché, aucun remote). */
export function syncButton(
  state: RemoteState | undefined,
  busy: NetworkGesture | null,
): SyncButton | null {
  const loading = busy !== null;
  switch (state?.kind) {
    case undefined:
    case "none":
      return null;
    case "ambiguousRemote":
      return {
        action: "none",
        label: i18n.t("git:remote.button.publish"),
        icon: "cloud-upload",
        showLabel: true,
        disabled: true,
        reason: i18n.t("git:remote.ambiguous"),
      };
    case "publishable":
      return {
        action: "publish",
        label: i18n.t("git:remote.button.publish"),
        icon: "cloud-upload",
        showLabel: true,
        disabled: loading,
        reason: null,
      };
    case "upstream": {
      if (state.ahead > 0 && state.behind > 0) {
        return {
          action: "none",
          label: i18n.t("git:remote.button.diverged"),
          icon: "refresh-cw",
          showLabel: true,
          disabled: true,
          reason: i18n.t("git:remote.diverged", { name: state.name }),
        };
      }
      if (state.ahead > 0) {
        return {
          action: "push",
          label: i18n.t("git:remote.button.push"),
          icon: "arrow-up",
          showLabel: true,
          disabled: loading,
          reason: null,
        };
      }
      if (state.behind > 0) {
        return {
          action: "pull",
          label: i18n.t("git:remote.button.pull"),
          icon: "arrow-down",
          showLabel: true,
          disabled: loading,
          reason: null,
        };
      }
      return {
        action: "fetch",
        label: i18n.t("git:remote.button.fetch"),
        icon: "refresh-cw",
        showLabel: false,
        disabled: loading,
        reason: null,
      };
    }
  }
}

/** « Committer et pousser » est proposé si la branche a un amont ou peut être publiée. */
export function canCommitAndPush(state: RemoteState | undefined): boolean {
  return hasRemote(state);
}

/** Notification d'un push réussi. */
export function pushedText(state: RemoteState | undefined): string {
  if (state?.kind === "upstream") return i18n.t("git:remote.pushed", { name: state.name });
  if (state?.kind === "publishable")
    return i18n.t("git:remote.published", { remote: state.remote });
  return i18n.t("git:remote.pushedPlain");
}

/** Notification d'un pull réussi (`count` commits tirés depuis l'amont). */
export function pulledText(count: number, state: RemoteState | undefined): string {
  if (count === 0) return i18n.t("git:remote.upToDate");
  if (state?.kind === "upstream")
    return i18n.t("git:remote.pulledFrom", { count, name: state.name });
  return i18n.t("git:remote.pulled", { count });
}

type RemoteFailure = { kind: RemoteErrorKind; output: string };

function remoteFailure(error: unknown): RemoteFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const { kind, message } = error as { kind?: unknown; message?: unknown };
  if (kind !== "Remote" || typeof message !== "object" || message === null) return null;
  const { kind: genre, output } = message as { kind?: unknown; output?: unknown };
  if (typeof genre !== "string" || typeof output !== "string") return null;
  return { kind: genre as RemoteErrorKind, output };
}

/** Sortie brute de git d'une erreur, ou son texte. */
function errorOutput(error: unknown): string {
  const failure = remoteFailure(error);
  if (failure !== null) {
    return failure.output || kindSummary(failure.kind, i18n.t("git:remote.theRemote"), null);
  }
  if (isAppError(error)) return appErrorText(error);
  return String(error);
}

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

/** Phrase du genre d'erreur ; `upstream` sert au message de divergence. */
function kindSummary(kind: RemoteErrorKind, remote: string, upstream: string | null): string {
  switch (kind) {
    case "auth":
      return i18n.t("git:remote.kind.auth", { remote });
    case "unreachable":
      return i18n.t("git:remote.kind.unreachable", { remote });
    case "timeout":
      return i18n.t("git:remote.kind.timeout");
    case "rejected":
      return i18n.t("git:remote.kind.rejected");
    case "diverged":
      return i18n.t("git:remote.diverged", { name: upstream ?? remote });
    case "noRemote":
      return i18n.t("git:remote.kind.noRemote");
    case "ambiguousRemote":
      return i18n.t("git:remote.ambiguous");
    case "localChanges":
    case "other":
      return "";
  }
}

/**
 * Texte du bloc d'erreur d'un geste réseau manuel : la phrase du genre reconnu, une piste pour
 * l'authentification, puis la sortie de git telle quelle.
 */
export function remoteErrorText(error: unknown, state: RemoteState | undefined): string {
  const failure = remoteFailure(error);
  if (failure === null) return errorOutput(error);
  const remote = remoteName(state) ?? "origin";
  const upstream = state?.kind === "upstream" ? state.name : null;
  const lines = [kindSummary(failure.kind, remote, upstream)];
  if (failure.kind === "auth") lines.push(i18n.t("git:remote.authHint"));
  if (failure.kind !== "unreachable" && failure.kind !== "timeout") {
    lines.push("", failure.output);
  } else if (failure.output !== "") {
    lines.push("", failure.output);
  }
  return lines.join("\n").trim();
}

/** Ce qui déclenche une récupération automatique. */
export type AutoTrigger = "open" | "focus" | "tick";

export type AutoContext = {
  hasRemote: boolean;
  /** Un geste réseau est déjà en cours. */
  running: boolean;
  /** Une récupération automatique a échoué : arrêt jusqu'à un geste manuel réussi. */
  stopped: boolean;
  /** Dernière récupération réussie (ms), `null` si aucune. */
  lastFetch: number | null;
  now: number;
  /** La fenêtre a le focus. */
  windowFocused: boolean;
};

/**
 * Faut-il récupérer maintenant ? Ouverture du volet : oui. Retour du focus : si la dernière
 * récupération date de plus de 2 min. Minuteur : fenêtre active, 5 min après la dernière.
 */
export function shouldAutoFetch(trigger: AutoTrigger, context: AutoContext): boolean {
  if (!context.hasRemote || context.running || context.stopped) return false;
  const age = context.lastFetch === null ? Infinity : context.now - context.lastFetch;
  switch (trigger) {
    case "open":
      return true;
    case "focus":
      return age > FOCUS_STALE_MS;
    case "tick":
      return context.windowFocused && age >= AUTO_INTERVAL_MS;
  }
}
