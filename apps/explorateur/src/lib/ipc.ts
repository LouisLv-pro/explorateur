import type { AppError } from "@/bindings";
import { appErrorMessage } from "@/i18n/errors";

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Renvoie la donnée d'une commande, ou lève son `AppError` (pour TanStack Query). */
export function unwrap<T>(result: CommandResult<T>): T {
  if (result.status === "error") throw result.error;
  return result.data;
}

/**
 * Texte d'une `AppError` : le message, la sortie de git pour `Remote`, la raison pour
 * `GithubUnavailable`, le genre quand il n'y a rien d'autre (`IssueNotFound`).
 */
export function appErrorText(error: AppError): string {
  if (!("message" in error)) return error.kind;
  // Phrase de l'app (`Failed`) : traduite, elle n'a pas de texte brut à montrer seul.
  if (error.kind === "Failed") return appErrorMessage(error);
  return typeof error.message === "string"
    ? error.message
    : (error.message as { output: string }).output;
}

export function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value;
}
