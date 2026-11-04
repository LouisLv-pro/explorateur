// Message d'une erreur de Rust dans la langue active, selon son `kind` (décision 0019) : Rust
// n'envoie que des genres et des données brutes.
import type { AppError, Failure } from "@/bindings";
import i18n from "@/i18n";

/** Phrase d'un `Failed` selon sa raison ; les données brutes y sont placées telles quelles. */
function failureMessage(failure: Failure): string {
  switch (failure.reason) {
    case "toolNotFound":
      return i18n.t("errors:failed.toolNotFound", failure.detail);
    case "unreadableOutput":
      return failure.detail.error === ""
        ? i18n.t("errors:failed.unreadableOutput", failure.detail)
        : i18n.t("errors:failed.unreadableOutputDetail", failure.detail);
    default:
      return "detail" in failure
        ? i18n.t(`errors:failed.${failure.reason}`, { detail: failure.detail })
        : i18n.t(`errors:failed.${failure.reason}`);
  }
}

/** Message traduit d'une `AppError` ; les sorties de git et de `gh` restent telles quelles. */
export function appErrorMessage(error: AppError): string {
  switch (error.kind) {
    case "InvalidUrl": {
      const url = error.message;
      return url.reason === "unsupportedScheme"
        ? i18n.t("errors:invalidUrl.unsupportedScheme", { scheme: url.scheme })
        : i18n.t(`errors:invalidUrl.${url.reason}`);
    }
    case "Remote":
      return i18n.t("errors:Remote", { detail: error.message.output });
    case "GithubUnavailable":
      return i18n.t("errors:GithubUnavailable");
    case "IssueNotFound":
      return i18n.t("errors:IssueNotFound");
    case "Failed":
      return failureMessage(error.message);
    default:
      return i18n.t(`errors:${error.kind}`, { detail: error.message });
  }
}
