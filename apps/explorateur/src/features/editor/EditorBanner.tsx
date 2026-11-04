import { CircleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { closeBanner, keepChanges, reloadDocument, type Banner } from "./documents";

/** Bannière de l'onglet sous son en-tête : conflit, fichier supprimé, échec d'enregistrement. */
export function EditorBanner({
  banner,
  docKey,
  path,
}: {
  banner: Banner;
  docKey: string;
  path: string;
}) {
  const { t } = useTranslation(["editor", "common"]);
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-b border-hairline bg-warning-soft py-1.5 pr-3 pl-4 text-body-sm text-ink"
    >
      <CircleAlert className="size-4 shrink-0 text-warning-deep" aria-hidden />
      {banner.kind === "conflict" ? (
        <>
          <span className="min-w-0 flex-1">{t("banner.conflict")}</span>
          <Button variant="outline" size="xs" onClick={() => void reloadDocument(docKey, path)}>
            {t("banner.reload")}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void keepChanges(docKey, path)}>
            {t("banner.keepMine")}
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            {banner.kind === "deleted" ? t("banner.deleted") : t(`banner.${banner.reason}`)}
          </span>
          {banner.kind === "error" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("common:close")}
              onClick={() => closeBanner(docKey)}
            >
              <X />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
