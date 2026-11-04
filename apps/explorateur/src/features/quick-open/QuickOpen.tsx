import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileMatch, RootFolder } from "@/bindings";
import {
  PaletteBody,
  PaletteDialog,
  PaletteOption,
  type RowProps,
} from "@/features/commands/PaletteFrame";
import { globalAction } from "@/features/shortcuts/useShortcuts";
import { EntryIcon } from "@/features/tree/EntryIcon";
import { useExistingPaths } from "@/features/session/existence";
import { useRecentFiles, useWorkspace } from "@/features/workspace/context";
import { relativePath } from "@/lib/paths";
import { useFindFiles } from "./api";
import { entryOf, highlightSegments, parseQuery, splitRelative } from "./match";

/** Palette ⌘P : trouve un fichier du dossier racine en quelques lettres et l'ouvre. */
export function QuickOpen({ root }: { root: RootFolder }) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(false);

  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    // Sans attendre la fermeture des menus : ⌘P referme aussi la palette ouverte.
    if (globalAction(event) === "quick-open") {
      event.preventDefault();
      setOpen((v) => !v);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <PaletteDialog open={open} onOpenChange={setOpen} title={t("quickOpen.title")}>
      <Palette root={root} onDone={() => setOpen(false)} />
    </PaletteDialog>
  );
}

/** Contenu de la palette, monté à l'ouverture : requête et sélection repartent à zéro. */
function Palette({ root, onDone }: { root: RootFolder; onDone: () => void }) {
  const { t } = useTranslation("app");
  const { showHidden, openFile } = useWorkspace();
  const [query, setQuery] = useState("");

  // `nom:42` : on cherche `nom`, le résultat s'ouvre à la ligne 42 (spec recherche-rapide-ligne.md).
  const { text, line } = parseQuery(query);
  const search = useFindFiles(root.path, text, showHidden);
  const typed = text.trim() !== "";
  // `:42` seul : rien à chercher, ni récents (la requête n'est pas vide) : le message d'invite.
  const blank = query.trim() === "";
  const recent = useRecentMatches(root);
  const results = useMemo(
    () => (typed ? (search.data ?? []) : blank ? recent : []),
    [typed, blank, search.data, recent],
  );

  function choose(match: FileMatch) {
    openFile(entryOf(match), line === null ? undefined : { line });
    onDone();
  }

  return (
    <PaletteBody
      query={query}
      onQueryChange={setQuery}
      items={results}
      getKey={(match) => match.path}
      renderItem={(match, row) => <Result row={row} match={match} />}
      onChoose={choose}
      placeholder={t("quickOpen.placeholder")}
      label={t("quickOpen.label")}
      listLabel={t("quickOpen.list")}
      idPrefix="quick-open"
      emptyMessage={
        !typed
          ? t("quickOpen.prompt")
          : search.isError
            ? t("quickOpen.error")
            : search.isSuccess && !search.isPlaceholderData
              ? t("quickOpen.empty")
              : ""
      }
    />
  );
}

/** Récents montrés par ⌘P vide (spec continuite.md). */
const MAX_RECENT_SHOWN = 10;

/**
 * Fichiers récemment activés, du plus récent au plus ancien, sans celui de l'onglet actif ni
 * ceux qui n'existent plus, en lignes de résultat sans lettre en gras. Vide tant que
 * l'existence des fichiers n'est pas connue.
 */
function useRecentMatches(root: RootFolder): FileMatch[] {
  const recent = useRecentFiles();
  const activePath = useWorkspace().activeTab?.path;
  const paths = useMemo(
    () => recent.map((file) => file.path).filter((path) => path !== activePath),
    [recent, activePath],
  );
  const existing = useExistingPaths(paths);
  // Chaîne stable : la liste ne change d'identité que si son contenu change.
  const shown =
    existing === null
      ? ""
      : paths
          .filter((path) => existing.has(path))
          .slice(0, MAX_RECENT_SHOWN)
          .join("\n");
  return useMemo(
    () =>
      shown === ""
        ? []
        : shown.split("\n").map((path) => ({
            path,
            relative_path: relativePath(path, root.path),
            score: 0,
            matched: [],
          })),
    [shown, root.path],
  );
}

function Result({ row, match }: { row: RowProps; match: FileMatch }) {
  const { name, dir } = splitRelative(match.relative_path);
  const offset = dir === "" ? 0 : [...dir].length + 1;
  const entry = entryOf(match);

  return (
    <PaletteOption row={row}>
      <EntryIcon entry={entry} open={false} className="size-4 shrink-0 text-mute" aria-hidden />
      {/* Taille hors de `cn` : tailwind-merge confond `text-body-sm` et `text-body`. */}
      <span className="shrink-0 text-body-sm text-ink">
        {highlightSegments(name, offset, match.matched).map((segment, i) =>
          segment.bold ? (
            <b key={i} className="font-semibold">
              {segment.text}
            </b>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </span>
      {dir !== "" && (
        // `direction: rtl` fait tronquer le début du chemin (`…/dossier`) ; `bdi` garde l'ordre des lettres.
        <span
          title={dir}
          className="min-w-0 flex-1 overflow-hidden text-right text-caption text-ellipsis whitespace-nowrap text-mute [direction:rtl]"
        >
          <bdi>{dir}</bdi>
        </span>
      )}
    </PaletteOption>
  );
}
