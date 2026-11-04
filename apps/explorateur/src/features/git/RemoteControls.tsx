// En-tête du volet Modifications, à droite du nom de la branche (docs/specs/git-distant.md) :
// `↑A ↓B` (clic = récupérer) et bouton de synchronisation dont le libellé suit l'état.
import { useState } from "react";
import { ArrowDown, ArrowUp, CloudUpload, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useRemoteSync } from "./context";
import { countsText, remoteTooltip, syncButton, type SyncButton } from "./remote";

const ICONS = {
  "refresh-cw": RefreshCw,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "cloud-upload": CloudUpload,
} as const;

/** Heure de l'ouverture d'une infobulle : « récupéré il y a 3 min » se calcule à ce moment. */
function useNowOnOpen() {
  const [now, setNow] = useState(() => Date.now());
  return { now, onOpenChange: (open: boolean) => open && setNow(Date.now()) };
}

export function RemoteControls() {
  const { t } = useTranslation("git");
  const remote = useRemoteSync();
  const { now, onOpenChange } = useNowOnOpen();
  const button = syncButton(remote.state, remote.busy);
  if (button === null) return null;
  const counts = countsText(remote.state);
  const details = remoteTooltip(remote.state, remote.lastFetch, now);
  const lines = [details, remote.autoError].filter((line): line is string => !!line);

  function run(action: SyncButton["action"]) {
    if (action === "fetch") remote.fetch();
    else if (action === "pull") remote.pull();
    else if (action === "push" || action === "publish") void remote.push();
  }

  const Icon = ICONS[button.icon];
  const busy = remote.busy !== null;
  return (
    <>
      {counts !== "" && (
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={busy}
              onClick={remote.fetch}
              aria-label={t("remote.countsLabel", { counts })}
              className="shrink-0 rounded-xs px-1 font-mono text-caption-mono text-body outline-none hover:bg-hairline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:text-mute"
            >
              {counts}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Lines lines={lines} />
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          {/* Enveloppe : une infobulle sur un bouton désactivé ne reçoit pas le survol. */}
          <span className="shrink-0">
            <Button
              variant="ghost"
              size={button.showLabel ? "xs" : "icon-xs"}
              disabled={button.disabled}
              aria-label={button.label}
              aria-busy={busy}
              onClick={() => run(button.action)}
              className={cn("text-mute", button.showLabel && "text-body")}
            >
              {busy ? (
                <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
              ) : (
                <Icon aria-hidden />
              )}
              {button.showLabel && <span className="text-caption">{button.label}</span>}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Lines lines={button.reason ? [button.reason] : [button.label, ...lines]} />
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <span className="grid gap-0.5">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}
