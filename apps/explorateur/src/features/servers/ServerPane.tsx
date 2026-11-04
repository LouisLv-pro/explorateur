// Onglet d'aperçu d'un serveur local (glossaire : ServerPreview) : barre d'URL et iframe.
import { useEffect, useEffectEvent, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, Play, RotateCw, SquareTerminal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Message } from "@/features/preview/Message";
import { serverAction, shortcutHint } from "@/features/shortcuts/shortcuts";
import { isInTerminal } from "@/features/terminal/context";
import i18n from "@/i18n";
import { useServers } from "./context";
import { serverStatus, statusLabel } from "./model";
import { StatusDot } from "./StatusDot";
import { REFUSED_URL_MESSAGE, resolveServerUrl } from "./url";

/** Le focus est dans l'aperçu ou sur la barre d'onglets (⌘R), pas dans le terminal ni ailleurs. */
function focusAllowsReload(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || isInTerminal(target)) return false;
  // Le nom de la barre d'onglets suit la langue (espace `app`).
  const tabs = `[role=tablist][aria-label="${CSS.escape(i18n.t("app:tabs.list"))}"]`;
  return (
    target === document.body ||
    target.closest(`[data-server-pane], [data-preview], ${tabs}`) !== null
  );
}

export function ServerPane({ serverKey }: { serverKey: string }) {
  const { t } = useTranslation("servers");
  const servers = useServers();
  const server = servers.serverOf(serverKey);
  const run = servers.runs.get(serverKey);
  const base = run?.url ?? server?.url ?? null;
  // Dernière URL saisie, valable tant que l'URL du serveur ne change pas.
  const [typed, setTyped] = useState<{ base: string; url: string } | null>(null);
  const current = base !== null && typed?.base === base ? typed.url : base;
  const [draft, setDraft] = useState<string | null>(null);
  // Clé du message de refus : traduite au rendu.
  const [refused, setRefused] = useState<typeof REFUSED_URL_MESSAGE | null>(null);
  const [reloads, setReloads] = useState(0);

  // ⌘R : seul le volet visible écoute (`<Activity>` démonte les effets des autres).
  // Le focus dans l'iframe (autre origine) ne remonte pas jusqu'ici : la touche reste au site.
  useReloadShortcut(() => setReloads((n) => n + 1));

  if (server === undefined) {
    return (
      <Message>
        <p>{t("pane.gone")}</p>
      </Message>
    );
  }

  const status = serverStatus(server, run);
  const showFrame = status === null || status === "online";
  const reloadHint = shortcutHint("server-reload");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (base === null || current === null) return;
    const result = resolveServerUrl(draft ?? current, current);
    if (!result.ok) {
      setRefused(result.message);
      return;
    }
    setRefused(null);
    setDraft(null);
    setTyped({ base, url: result.url });
    setReloads((n) => n + 1);
  }

  return (
    <div data-server-pane className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline pr-3 pl-3">
        <StatusDot status={status} />
        <span className="shrink-0 text-mute">
          <span className="text-body-sm">{statusLabel(status)}</span>
        </span>
        <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col">
          <input
            aria-label={t("pane.address")}
            aria-invalid={refused !== null}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={current === null}
            value={draft ?? current ?? ""}
            placeholder={t("pane.unknownUrl")}
            onChange={(event) => {
              setDraft(event.target.value);
              setRefused(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(null);
                setRefused(null);
              }
            }}
            className="h-7 w-full min-w-0 rounded-sm border border-hairline bg-canvas px-2 font-mono text-caption-mono text-ink outline-none focus-visible:border-hairline-strong aria-invalid:border-error"
          />
        </form>
        <BarButton
          label={t("pane.reload", { shortcut: reloadHint })}
          disabled={!showFrame || current === null}
          onClick={() => setReloads((n) => n + 1)}
        >
          <RotateCw />
        </BarButton>
        <BarButton
          label={t("pane.openInBrowser")}
          disabled={current === null}
          onClick={() => {
            if (current !== null) void openUrl(current).catch(() => {});
          }}
        >
          <ExternalLink />
        </BarButton>
      </header>
      {refused !== null && (
        <p role="alert" className="border-b border-hairline px-4 py-1.5 text-error">
          <span className="text-body-sm">{i18n.t(refused)}</span>
        </p>
      )}
      {showFrame && current !== null ? (
        // Sans `sandbox` (décision 0008) : le site doit fonctionner comme dans un navigateur ;
        // d'une autre origine, il n'accède ni à l'IPC ni au DOM de l'app. Fond blanc et
        // schéma clair dans les deux thèmes, comme les pages HTML (`PageFrame`).
        <iframe
          key={`${run?.onlineSeq ?? 0}-${reloads}`}
          title={t("pane.previewOf", { name: server.name })}
          src={current}
          className="min-h-0 w-full min-w-0 flex-1 border-0 bg-white scheme-light"
        />
      ) : status === "starting" ? (
        <Message>
          <p>{t("status.starting")}</p>
          <Button variant="outline" size="sm" onClick={() => servers.showTerminal(serverKey)}>
            <SquareTerminal />
            {t("gesture.terminal")}
          </Button>
        </Message>
      ) : (
        <Message>
          <p>{t("pane.stopped")}</p>
          <Button variant="outline" size="sm" onClick={() => servers.launch(server)}>
            <Play />
            {t("gesture.launch")}
          </Button>
        </Message>
      )}
    </div>
  );
}

/** ⌘R (ligne `handledBy: "server"`), focus dans l'aperçu ou sur la barre d'onglets. */
function useReloadShortcut(reload: () => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector(OVERLAY) !== null) return;
    if (serverAction(event) !== "server-reload" || !focusAllowsReload(event.target)) return;
    event.preventDefault();
    reload();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Menu, palette ou dialogue ouvert : ils gardent leurs touches (comme `useShortcuts`).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function BarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-mute"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
