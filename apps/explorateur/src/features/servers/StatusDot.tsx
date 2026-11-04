import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { appStatusLabel, type AppStatus } from "./apps";
import { statusLabel, type ServerStatus } from "./model";

const DOT_CLASS: Record<ServerStatus | AppStatus, string> = {
  stopped: "bg-hairline-strong",
  starting: "bg-warning motion-safe:animate-pulse",
  online: "bg-success",
  running: "bg-success",
};

/**
 * Pastille d'état d'un serveur (`null` : lancé ailleurs, sans état suivi) ou d'une app native.
 * `label` remplace le libellé lu par les lecteurs d'écran (« Arrêtée » pour une app).
 */
export function StatusDot({
  status,
  label,
  className,
}: {
  status: ServerStatus | AppStatus | null;
  label?: string;
  className?: string;
}) {
  // Redessiné au changement de langue.
  useTranslation();
  const text = label ?? (status === "running" ? appStatusLabel("running") : statusLabel(status));
  return (
    <span
      role="img"
      aria-label={text}
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === null ? "border border-hairline-strong" : DOT_CLASS[status],
        className,
      )}
    />
  );
}
