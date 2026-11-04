// Bouton « Serveurs » de la barre d'onglets et son menu (specs serveurs-locaux.md,
// apps-natives.md et menu-apps-allege.md) : section Serveurs, puis section Apps (une ligne par
// app, ses cibles côte à côte).
import { Fragment, useState, type MouseEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Globe,
  Play,
  Server as ServerIcon,
  Smartphone,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { AppTarget, DeviceSource, NativeApp, Server } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/features/workspace/context";
import { cn } from "@/lib/utils";
import {
  activeCount,
  appStatusLabel,
  appSubtitle,
  appUsesAndroid,
  appUsesFlutter,
  appUsesXcode,
  devicePickerLabel,
  devicePickerTooltip,
  deviceSourceText,
  groupRunsByApp,
  isFlutterTarget,
  isXcodeTarget,
  targetKey,
  targetLabel,
  type AppGesture,
  type AppStatus,
  type DevicePicker,
} from "./apps";
import { useServers, type ServersState } from "./context";
import {
  gestureLabel,
  serverGestures,
  serverKey,
  serverStatus,
  serverSubtitle,
  shownPort,
  type ServerGesture,
  type ServerRun,
} from "./model";
import { StatusDot } from "./StatusDot";

/** Nom du fichier de configuration, laissé tel quel dans toutes les langues. */
const LAUNCH_FILE = ".claude/launch.json";

/** Éléments en ligne des textes `Trans` : une commande ou un chemin en police à chasse fixe. */
const MONO = [
  <span key="0" className="font-mono text-caption-mono" />,
  <span key="1" className="font-mono text-caption-mono" />,
];

const GESTURE_ICONS: Record<ServerGesture, typeof Play> = {
  launch: Play,
  preview: Globe,
  stop: Square,
  terminal: SquareTerminal,
};

function runGesture(servers: ServersState, server: Server, gesture: ServerGesture) {
  const key = serverKey(server);
  switch (gesture) {
    case "launch":
      servers.launch(server);
      break;
    case "preview":
      servers.preview(server);
      break;
    case "stop":
      servers.stop(key);
      break;
    case "terminal":
      servers.showTerminal(key);
      break;
  }
}

function runAppGesture(
  servers: ServersState,
  app: NativeApp,
  target: AppTarget,
  gesture: AppGesture,
) {
  const key = targetKey(app, target);
  switch (gesture) {
    case "launch":
      servers.launchApp(app, target);
      break;
    case "stop":
      servers.stopApp(key);
      break;
    case "terminal":
      servers.showAppTerminal(key);
      break;
  }
}

export function ServersButton() {
  const { t } = useTranslation("servers");
  const servers = useServers();
  const { root } = useWorkspace();
  const [open, setOpen] = useState(false);
  const active = activeCount(servers.runs, servers.appRuns);
  const label = active > 0 ? t("button.labelActive", { active }) : t("button.label");
  const { servers: detected, launchError } = servers.detected;
  const { apps } = servers;
  const elsewhere = [...servers.runs.values()].filter((r) => r.rootPath !== root?.path);
  const appsElsewhere = groupRunsByApp(
    [...servers.appRuns.values()].filter((r) => r.rootPath !== root?.path),
  );
  const nothing = detected.length === 0 && apps.length === 0;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) servers.refresh();
  }

  function gesture(server: Server, value: ServerGesture) {
    setOpen(false);
    runGesture(servers, server, value);
  }

  function appGesture(app: NativeApp, target: AppTarget, value: AppGesture) {
    setOpen(false);
    runAppGesture(servers, app, target, value);
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size={active > 0 ? "sm" : "icon-sm"}
              aria-label={label}
              className={cn("text-mute", open && "bg-hairline text-ink")}
            >
              <ServerIcon />
              {active > 0 && <span className="font-mono text-caption-mono">{active}</span>}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" loop className="w-96">
        {launchError !== null && (
          <>
            <DropdownMenuLabel className="text-mute">{LAUNCH_FILE}</DropdownMenuLabel>
            <p role="alert" className="px-1.5 pb-1.5 text-error">
              <span className="text-body-sm">{t("error.launchFile", { detail: launchError })}</span>
            </p>
            <DropdownMenuSeparator />
          </>
        )}
        {nothing ? (
          <div className="px-1.5 py-1">
            <p className="text-body-sm text-ink">{t("button.nothing.title")}</p>
            <p className="text-caption text-mute">{t("button.nothing.hint")}</p>
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="text-mute">{t("button.servers")}</DropdownMenuLabel>
            {detected.length === 0 ? (
              <div className="px-1.5 py-1">
                <p className="text-body-sm text-ink">{t("button.noServer.title")}</p>
                <p className="text-caption text-mute">{t("button.noServer.hint")}</p>
              </div>
            ) : (
              detected.map((server) => (
                <ServerLine
                  key={serverKey(server)}
                  server={server}
                  run={servers.runs.get(serverKey(server))}
                  onGesture={gesture}
                />
              ))
            )}
            {apps.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-mute">{t("button.apps")}</DropdownMenuLabel>
                {servers.xcodeMissing && apps.some(appUsesXcode) && (
                  <div role="alert" className="px-1.5 pb-1">
                    <p className="text-body-sm text-error">{t("button.xcodeMissing.title")}</p>
                    <p className="text-caption text-mute">
                      <Trans t={t} i18nKey="button.xcodeMissing.hint" components={MONO} />
                    </p>
                  </div>
                )}
                {servers.flutterMissing && apps.some(appUsesFlutter) && (
                  <div role="alert" className="px-1.5 pb-1">
                    <p className="text-body-sm text-error">{t("button.flutterMissing.title")}</p>
                    <p className="text-caption text-mute">
                      <Trans t={t} i18nKey="button.flutterMissing.hint" components={MONO} />
                    </p>
                  </div>
                )}
                {servers.flutterError !== null && !servers.flutterMissing && (
                  <div role="alert" className="px-1.5 pb-1">
                    <p className="text-body-sm text-error">{t("button.flutterUnreadable")}</p>
                    <p className="text-caption text-mute">{servers.flutterError}</p>
                  </div>
                )}
                {servers.androidSdkMissing && apps.some(appUsesAndroid) && (
                  <div role="alert" className="px-1.5 pb-1">
                    <p className="text-body-sm text-error">{t("button.androidMissing.title")}</p>
                    <p className="text-caption text-mute">
                      <Trans t={t} i18nKey="button.androidMissing.hint" components={MONO} />
                    </p>
                  </div>
                )}
                {apps.map((app) => (
                  <AppLine
                    key={`${app.relativeDir}::${app.name}`}
                    app={app}
                    targets={app.targets}
                    servers={servers}
                    onGesture={appGesture}
                  />
                ))}
              </>
            )}
          </>
        )}
        {(elsewhere.length > 0 || appsElsewhere.length > 0) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-mute">{t("button.otherFolders")}</DropdownMenuLabel>
            {elsewhere.map((run) => (
              <ServerLine
                key={run.key}
                server={run.server}
                run={run}
                elsewhere
                onGesture={gesture}
              />
            ))}
            {appsElsewhere.map((group) => (
              <AppLine
                key={group.key}
                app={group.app}
                targets={group.runs.map((run) => run.target)}
                servers={servers}
                elsewhere
                onGesture={appGesture}
              />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Gestes d'une ligne en boutons-icônes, hors de la navigation au clavier. */
function GestureButtons<G extends ServerGesture | AppGesture>({
  gestures,
  disabled = [],
  onGesture,
}: {
  gestures: G[];
  disabled?: G[];
  onGesture: (gesture: G) => void;
}) {
  // Redessiné au changement de langue.
  useTranslation("servers");
  const first = gestures[0];
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {gestures.map((value) => {
        const Icon: typeof Play = GESTURE_ICONS[value];
        const label = gestureLabel(value);
        return (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <Button
                variant={value === first ? "outline" : "ghost"}
                size="icon-xs"
                tabIndex={-1}
                aria-label={label}
                disabled={disabled.includes(value)}
                onClick={(event: MouseEvent) => {
                  // Le clic ne doit pas aussi déclencher le premier geste de la ligne.
                  event.stopPropagation();
                  event.preventDefault();
                  onGesture(value);
                }}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Ligne d'un serveur : un seul élément du menu (flèches, `↵` = premier geste), ses gestes en
 * boutons hors de la navigation au clavier.
 */
function ServerLine({
  server,
  run,
  elsewhere = false,
  onGesture,
}: {
  server: Server;
  run: ServerRun | undefined;
  /** Section « Autres dossiers » : Aperçu et Arrêter seulement. */
  elsewhere?: boolean;
  onGesture: (server: Server, gesture: ServerGesture) => void;
}) {
  const status = serverStatus(server, run);
  const all = serverGestures(server, status ?? "stopped");
  const gestures = elsewhere ? all.filter((g) => g === "preview" || g === "stop") : all;
  const port = shownPort(server, run?.url ?? null);
  const first = gestures[0];

  return (
    <DropdownMenuItem
      disabled={first === undefined}
      onSelect={() => {
        if (first !== undefined) onGesture(server, first);
      }}
      className="items-start gap-2 py-1.5"
    >
      <StatusDot status={status} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm text-ink">
          {server.name}
          {port !== null && (
            <span className="ml-2 font-mono text-caption-mono text-mute">{`:${port}`}</span>
          )}
        </p>
        <p className="truncate font-mono text-caption-mono text-mute">{serverSubtitle(server)}</p>
      </div>
      <GestureButtons gestures={gestures} onGesture={(value) => onGesture(server, value)} />
    </DropdownMenuItem>
  );
}

const TARGET_ICONS: Record<AppGesture, typeof Play> = {
  launch: Play,
  stop: Square,
  terminal: SquareTerminal,
};

/** Classes communes des éléments d'une ligne d'app (DESIGN.md `menu-row-targets`). */
const TARGET_ITEM = "h-6 shrink-0 gap-1 py-0 focus:bg-canvas-soft-2";

/** Un geste d'une cible : élément du menu (flèches, `↵`) avec son infobulle. */
function TargetItem({
  gesture,
  label,
  disabled = false,
  text,
  onSelect,
}: {
  gesture: AppGesture;
  /** Nom accessible et infobulle : « Lancer NimbusDemo · iOS ». */
  label: string;
  disabled?: boolean;
  /** Libellé visible (geste principal) ; absent : icône seule. */
  text?: string;
  onSelect: () => void;
}) {
  const Icon = TARGET_ICONS[gesture];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-label={label}
          disabled={disabled}
          onSelect={onSelect}
          className={cn(
            TARGET_ITEM,
            text === undefined
              ? "w-6 justify-center p-0 text-mute"
              : "border border-hairline px-2 text-ink",
          )}
        >
          <Icon className="size-3.5" />
          {text !== undefined && <span className="text-caption">{text}</span>}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Sélecteur d'appareil d'une cible : élément du menu qui ouvre la liste (`→`, `←`). */
function DevicePickerItem({
  app,
  target,
  source,
  picker,
  servers,
}: {
  app: NativeApp;
  target: AppTarget;
  source: DeviceSource;
  picker: DevicePicker;
  servers: ServersState;
}) {
  const { t } = useTranslation("servers");
  const text = deviceSourceText(source);
  const label = devicePickerLabel(source, app.name);
  return (
    <DropdownMenuSub>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuSubTrigger
            disabled={picker.devices.length === 0}
            aria-label={label}
            className={cn(TARGET_ITEM, "px-2 text-mute aria-expanded:bg-canvas-soft-2")}
          >
            <Smartphone className="size-3.5" />
            <span className="max-w-40 truncate text-caption">
              {picker.chosen?.name ??
                (picker.loading === true ? t("device.searching") : text.empty)}
            </span>
          </DropdownMenuSubTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {devicePickerTooltip(source, app.name, picker)}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuRadioGroup
          value={picker.chosen?.id ?? ""}
          onValueChange={(id) => servers.chooseDevice(app, target, id)}
        >
          {picker.devices.map((device) => (
            <DropdownMenuRadioItem
              key={device.id}
              value={device.id}
              // Le menu reste ouvert : le choix se voit sur la ligne de l'app.
              onSelect={(event) => event.preventDefault()}
            >
              <span className="truncate text-body-sm text-ink">{device.name}</span>
              <span className="ml-auto pl-3 font-mono text-caption-mono text-mute">
                {device.detail}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Ligne d'une app native (DESIGN.md `menu-row-targets`) : pastille, nom et sous-titre, puis ses
 * cibles côte à côte. Chaque geste et chaque sélecteur est un élément du menu, dans l'ordre de
 * lecture. Lancer est désactivé sans Xcode (cibles Xcode) ou sans appareil (cible à source).
 */
function AppLine({
  app,
  targets,
  servers,
  elsewhere = false,
  onGesture,
}: {
  app: NativeApp;
  /** Cibles affichées : toutes, ou dans « Autres dossiers » celles qui sont en cours. */
  targets: readonly AppTarget[];
  servers: ServersState;
  /** Section « Autres dossiers » : sans sélecteur. */
  elsewhere?: boolean;
  onGesture: (app: NativeApp, target: AppTarget, gesture: AppGesture) => void;
}) {
  const { t } = useTranslation("servers");
  const running = targets.some((target) => servers.appRuns.has(targetKey(app, target)));
  const appStatus: AppStatus = running ? "running" : "stopped";
  const runningLabel = appStatusLabel("running");
  // Aide sous la ligne quand une source répond sans aucun appareil (hors « Autres dossiers »).
  const emptyHelp = elsewhere
    ? null
    : (targets.flatMap((target) => {
        const picker = servers.devicesFor(app, target);
        const toolMissing = isFlutterTarget(target) && servers.flutterMissing;
        const text = target.deviceSource === null ? null : deviceSourceText(target.deviceSource);
        return text?.emptyHelp !== null &&
          text?.emptyHelp !== undefined &&
          picker !== null &&
          !toolMissing &&
          !picker.unavailable &&
          picker.loading !== true &&
          picker.devices.length === 0
          ? [text.emptyHelp]
          : [];
      })[0] ?? null);

  return (
    <div className="px-1.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={appStatus} label={appStatusLabel(appStatus)} />
        <p className="min-w-0 shrink truncate text-body-sm text-ink">{app.name}</p>
        <p className="min-w-0 flex-1 truncate font-mono text-caption-mono text-mute">
          {appSubtitle(app)}
        </p>
      </div>
      <div className="mt-1 ml-4 flex flex-wrap items-center gap-2">
        {targets.map((target) => {
          const label = targetLabel(app, target);
          const isRunning = servers.appRuns.has(targetKey(app, target));
          const picker = servers.devicesFor(app, target);
          const toolMissing =
            (isXcodeTarget(target) && servers.xcodeMissing) ||
            (isFlutterTarget(target) && servers.flutterMissing);
          const blocked =
            toolMissing || (picker !== null && (picker.unavailable || picker.chosen === null));
          // Pas de sélecteur dans « Autres dossiers », ni sans l'outil ou liste en échec
          // (« Xcode introuvable », « Flutter introuvable », « SDK Android introuvable »).
          const source =
            elsewhere || toolMissing || picker?.unavailable === true ? null : target.deviceSource;
          return (
            <Fragment key={target.id}>
              {!isRunning ? (
                <TargetItem
                  gesture="launch"
                  label={t("target.launch", { label })}
                  text={target.label}
                  disabled={blocked}
                  onSelect={() => onGesture(app, target, "launch")}
                />
              ) : (
                <>
                  <span className="flex items-center gap-1 text-body">
                    <StatusDot status="running" label={runningLabel} />
                    <span className="text-caption">{target.label}</span>
                  </span>
                  <TargetItem
                    gesture="terminal"
                    label={t("target.terminal", { label })}
                    onSelect={() => onGesture(app, target, "terminal")}
                  />
                  <TargetItem
                    gesture="stop"
                    label={t("target.stop", { label })}
                    onSelect={() => onGesture(app, target, "stop")}
                  />
                </>
              )}
              {source !== null && picker !== null && (
                <DevicePickerItem
                  app={app}
                  target={target}
                  source={source}
                  picker={picker}
                  servers={servers}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {emptyHelp !== null && <p className="mt-1 ml-4 text-caption text-mute">{emptyHelp}</p>}
    </div>
  );
}
