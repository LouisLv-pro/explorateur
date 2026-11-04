import type { AppError } from "@/bindings";
import i18n from "@/i18n";

/** Message sous le champ de nom pour les erreurs que l'utilisateur corrige en changeant le nom. */
export function nameErrorMessage(error: AppError): string | null {
  switch (error.kind) {
    case "AlreadyExists":
      return i18n.t("files:errors.exists");
    case "InvalidName":
      return i18n.t("files:errors.invalidName");
    default:
      return null;
  }
}

/** Message de la bannière d'erreur pour une écriture sur le disque (création, renommage, corbeille). */
export function writeErrorMessage(error: AppError): string {
  switch (error.kind) {
    case "NotFound":
      return i18n.t("files:errors.gone");
    case "PermissionDenied":
      return i18n.t("files:errors.denied");
    case "AlreadyExists":
    case "InvalidName":
      return nameErrorMessage(error) ?? i18n.t("common:actionFailed");
    default:
      return i18n.t("common:actionFailed");
  }
}
