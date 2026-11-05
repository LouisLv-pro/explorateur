import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import type { DisplayMode } from "./display";

/**
 * Bannière `role="alert"` d'un fichier invalide (données, notebook), suivie de la source en
 * mode Aperçu.
 */
export function Invalid({
  message,
  mode,
  source,
}: {
  message: string;
  mode: DisplayMode;
  source: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="alert"
        className="flex shrink-0 items-center gap-3 border-b border-hairline bg-warning-soft py-1.5 pr-3 pl-4 text-body-sm text-ink"
      >
        <CircleAlert className="size-4 shrink-0 text-warning-deep" aria-hidden />
        <span className="max-h-24 min-w-0 flex-1 overflow-y-auto break-words">{message}</span>
      </div>
      {mode === "rendered" && source}
    </div>
  );
}
