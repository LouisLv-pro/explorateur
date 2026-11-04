import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { highlightSegments } from "@/features/quick-open/match";
import { globalAction } from "@/features/shortcuts/useShortcuts";
import { useWorkspace } from "@/features/workspace/context";
import { CodeLinkCommands } from "./CodeLinkCommands";
import { filterCommands } from "./match";
import { OwnCommands } from "./OwnCommands";
import { PaletteBody, PaletteDialog, PaletteOption, type RowProps } from "./PaletteFrame";
import {
  availabilityOf,
  isAvailable,
  shortcutCommands,
  shortcutKeys,
  type Command,
} from "./registry";
import { useRegisteredCommands } from "./store";

type Hit = { command: Command; matched: number[] };

/**
 * Palette ⌘⇧P : lance une action de l'app en quelques lettres de son nom. Elle se ferme d'abord,
 * puis la commande s'exécute : les écouteurs de raccourcis s'effacent devant un dialogue ouvert
 * et ignoreraient la combinaison rejouée.
 */
export function CommandPalette() {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(false);
  // La commande choisie, lancée quand le dialogue a disparu et que le focus est revenu.
  const chosen = useRef<Command | null>(null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Comme ⌘P : aussi avec un menu ouvert, et ⌘⇧P referme la palette ouverte.
    if (globalAction(event) === "command-palette") {
      event.preventDefault();
      setOpen((value) => !value);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function choose(command: Command) {
    chosen.current = command;
    setOpen(false);
  }

  function runChosen() {
    const command = chosen.current;
    chosen.current = null;
    // Après le retour du focus (Radix le rend juste après cet événement).
    if (command) setTimeout(command.run, 0);
  }

  return (
    <>
      <OwnCommands />
      <PaletteDialog
        open={open}
        onOpenChange={setOpen}
        title={t("commands.title")}
        onCloseAutoFocus={runChosen}
      >
        <Palette onChoose={choose} />
      </PaletteDialog>
    </>
  );
}

/** Contenu de la palette, monté à l'ouverture : requête et sélection repartent à zéro. */
function Palette({ onChoose }: { onChoose: (command: Command) => void }) {
  const { root, activeTab, currentFile } = useWorkspace();
  const registered = useRegisteredCommands();
  const [query, setQuery] = useState("");
  // Libellés et groupes des raccourcis sont lus dans la langue active : relus au changement.
  const { t, i18n } = useTranslation("app");
  const language = i18n.resolvedLanguage;

  const state = availabilityOf(root !== null, activeTab);
  const { tab, previewKind, dirty } = state;
  // Monté ici et non dans `OwnCommands` : ses requêtes git et `gh` ne partent qu'à l'ouverture.
  const codeLinkPath = tab === "file" && currentFile !== null ? currentFile.path : null;
  // Les libellés et groupes de la table sont relus quand la langue change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tableCommands = useMemo(() => shortcutCommands(), [language]);
  const hits: Hit[] = useMemo(() => {
    const availability = { root: root !== null, tab, previewKind, dirty };
    const available = tableCommands.filter(
      (command) => command.shortcut === undefined || isAvailable(command.shortcut, availability),
    );
    return filterCommands([...available, ...registered], query);
  }, [tableCommands, root, tab, previewKind, dirty, registered, query]);

  return (
    <>
      {codeLinkPath !== null && <CodeLinkCommands path={codeLinkPath} />}
      <PaletteBody
        query={query}
        onQueryChange={setQuery}
        items={hits}
        getKey={(hit) => hit.command.id}
        renderItem={(hit, row) => <CommandRow row={row} hit={hit} />}
        onChoose={(hit) => onChoose(hit.command)}
        placeholder={t("commands.placeholder")}
        label={t("commands.label")}
        listLabel={t("commands.list")}
        idPrefix="command-palette"
        emptyMessage={t("commands.empty")}
      />
    </>
  );
}

function CommandRow({ row, hit }: { row: RowProps; hit: Hit }) {
  const { command, matched } = hit;
  const keys = command.shortcut ? shortcutKeys(command.shortcut) : [];

  return (
    <PaletteOption row={row}>
      {/* Taille hors de `cn` : tailwind-merge confond `text-body-sm` et `text-body`. */}
      <span title={command.label} className="min-w-0 truncate text-body-sm text-ink">
        {highlightSegments(command.label, 0, matched).map((segment, i) =>
          segment.bold ? (
            <b key={i} className="font-semibold">
              {segment.text}
            </b>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </span>
      <span className="shrink-0 text-caption text-mute">{command.group}</span>
      {keys.length > 0 && (
        <span className="ml-auto flex shrink-0 gap-1">
          {keys.map((key) => (
            <kbd
              key={key}
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs bg-canvas-soft-2 px-1.5 text-caption-mono text-ink"
            >
              {key}
            </kbd>
          ))}
        </span>
      )}
    </PaletteOption>
  );
}
