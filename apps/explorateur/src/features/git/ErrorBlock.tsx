// Sortie de git en cas d'échec : bloc monospace défilant et copiable, partagé par le commit et
// les gestes réseau (docs/specs/git-distant.md). `onClose` ajoute le `×`.
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorBlock({
  text,
  onClose,
  className,
  label,
}: {
  text: string;
  onClose?: () => void;
  className?: string;
  /** Nom accessible du bloc (« Sortie de gh » pour les issues) ; par défaut « Sortie de git ». */
  label?: string;
}) {
  const { t } = useTranslation(["git", "common"]);
  return (
    <div className={cn("relative", className)}>
      <pre
        role="alert"
        aria-label={label ?? t("errorBlock.output")}
        className={cn(
          "max-h-40 overflow-auto rounded-sm border border-hairline bg-canvas px-2 py-1.5 font-mono text-caption-mono whitespace-pre-wrap text-error select-text",
          onClose && "pr-8",
        )}
      >
        {text}
      </pre>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("common:close")}
          onClick={onClose}
          className="absolute top-1 right-1 text-mute"
        >
          <X />
        </Button>
      )}
    </div>
  );
}
