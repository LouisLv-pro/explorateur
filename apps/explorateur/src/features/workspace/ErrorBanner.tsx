import { CircleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Bannière discrète en bas de la fenêtre, pour une erreur d'ouverture. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md border border-hairline bg-canvas py-1.5 pr-1.5 pl-3 text-body-sm text-ink shadow-level-3"
    >
      <CircleAlert className="size-4 shrink-0 text-error" aria-hidden />
      <span>{message}</span>
      <Button variant="ghost" size="icon-xs" aria-label={t("close")} onClick={onDismiss}>
        <X />
      </Button>
    </div>
  );
}
