import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ReadNotice } from "./api";
import { lineSummary } from "./marks";

/** Bandeau sous l'en-tête du fichier : ce que la lecture a trouvé depuis la précédente. */
export function LastReadBanner({
  notice,
  showDiff,
  onToggleDiff,
  onDismiss,
}: {
  notice: ReadNotice;
  showDiff: boolean;
  onToggleDiff: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("files");
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-hairline bg-link-bg-soft py-1.5 pr-3 pl-4 text-body-sm text-ink"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-link" aria-hidden />
      {notice.kind === "Changed" ? (
        <>
          <span className="min-w-0 truncate">{t("lastRead.changed")}</span>
          <span className="shrink-0 font-mono text-caption-mono text-mute">
            {lineSummary(notice.added, notice.removed)}
          </span>
          <span className="flex-1" />
          <Button variant="outline" size="xs" onClick={onToggleDiff}>
            {showDiff ? t("lastRead.showFile") : t("lastRead.showChanges")}
          </Button>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          {notice.kind === "ChangedNoDiff" ? t("lastRead.noDiff") : t("lastRead.noBaseline")}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("lastRead.dismiss")}
        title={t("lastRead.dismiss")}
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}
