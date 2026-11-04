// Registre des commandes (docs/specs/palette-commandes.md), pur : chaque ligne rejouable de
// `SHORTCUTS` devient une commande qui renvoie sa combinaison de touches à la fenêtre.
import type { PreviewKind } from "@/bindings";
import {
  BROWSER_HELP_GROUP,
  GIT_HELP_GROUP,
  HELP_GROUPS,
  ISSUES_HELP_GROUP,
  SHORTCUTS,
  TERMINAL_HELP_GROUP,
  type KeyInput,
  type ShortcutAction,
} from "@/features/shortcuts/shortcuts";
import type { Tab } from "@/features/tabs/tabs";

/** Une commande de la palette. */
export type Command = {
  /** Unique dans la palette : l'action pour un raccourci, un nom libre pour une commande enregistrée. */
  id: string;
  label: string;
  group: string;
  /** Raccourci rappelé à droite de la ligne (touches de `SHORTCUTS`). */
  shortcut?: ShortcutAction;
  run: () => void;
};

// Ordre des groupes de l'aide des raccourcis, par identifiant (le titre suit la langue).
const GROUP_ORDER: readonly string[] = [
  ...HELP_GROUPS,
  TERMINAL_HELP_GROUP,
  GIT_HELP_GROUP,
  ISSUES_HELP_GROUP,
  BROWSER_HELP_GROUP,
].map((group) => group.id);

/**
 * Actions qui ne sont pas des commandes bien que leur ligne se rejoue : `issue-create` (dialogue
 * de création), `tab-1` (« 1 à 8 » n'est pas une commande), `terminal-toggle-alt` (même effet
 * que `terminal-toggle`), `command-palette` (la palette ne s'ouvre pas elle-même), et
 * `history-back` / `history-forward`, enregistrées par `WorkspaceProvider` seulement quand le
 * geste a un effet (spec continuite.md).
 */
const NOT_COMMANDS: ReadonlySet<ShortcutAction> = new Set([
  "issue-create",
  "tab-1",
  "terminal-toggle-alt",
  "command-palette",
  "history-back",
  "history-forward",
]);

/** Les touches que le menu, l'éditeur ou un composant prennent : un `keydown` sur `body` n'y arrive pas. */
const NOT_REPLAYABLE = new Set(["component", "editor", "menu"]);

type Rule = (typeof SHORTCUTS)[number];

function isReplayable(rule: Rule): boolean {
  return (
    !rule.hidden &&
    !rule.tree &&
    !rule.terminalFocus &&
    !rule.gitFocus &&
    !(rule.handledBy && NOT_REPLAYABLE.has(rule.handledBy)) &&
    !NOT_COMMANDS.has(rule.action)
  );
}

/** Le caractère que la touche physique `code` donne sans modificateur. */
function keyOfCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]?.toLowerCase() ?? code;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? code;
  if (code === "Backquote") return "`";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  return code;
}

/** La combinaison de touches d'une ligne, telle qu'un clavier la produirait. */
function inputOf(rule: Rule): KeyInput {
  let key: string;
  let code = "";
  if ("code" in rule.on) {
    code = rule.on.code;
    key = keyOfCode(code);
  } else {
    key = rule.on.key;
    // `event.key` s'écrit « Tab », « Enter », « L » avec Maj ; la table le garde en minuscules.
    if ([...key].length > 1) key = key.charAt(0).toUpperCase() + key.slice(1);
    else if (rule.shift) key = key.toUpperCase();
  }
  return {
    key,
    code,
    metaKey: rule.cmd ?? false,
    ctrlKey: rule.ctrl ?? false,
    altKey: rule.alt ?? false,
    shiftKey: rule.shift ?? false,
  };
}

/** Envoie la combinaison sur `body` : l'écouteur qui traite déjà le raccourci la reçoit. */
function replay(input: KeyInput): void {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { ...input, bubbles: true, cancelable: true }),
  );
}

/**
 * Une commande par action rejouable de `SHORTCUTS` (la première ligne d'une action portée par
 * deux), dans l'ordre des groupes de l'aide puis celui de la table.
 */
export function shortcutCommands(): Command[] {
  const seen = new Set<ShortcutAction>();
  const ranked: { rank: number; command: Command }[] = [];
  for (const rule of SHORTCUTS) {
    if (!isReplayable(rule) || seen.has(rule.action)) continue;
    seen.add(rule.action);
    const input = inputOf(rule);
    ranked.push({
      rank: GROUP_ORDER.indexOf(rule.groupId),
      command: {
        id: rule.action,
        label: rule.label,
        group: rule.group,
        shortcut: rule.action,
        run: () => replay(input),
      },
    });
  }
  // `sort` est stable : l'ordre de la table départage les commandes d'un même groupe.
  return ranked.sort((a, b) => a.rank - b.rank).map(({ command }) => command);
}

/** Les touches à afficher pour un raccourci (même ligne que `shortcutHint`). */
export function shortcutKeys(action: ShortcutAction): readonly string[] {
  return SHORTCUTS.find((rule) => rule.action === action)?.keys ?? [];
}

/** Le libellé de la ligne d'un raccourci (pour une commande faite par la palette). */
export function shortcutLabel(action: ShortcutAction): string {
  return SHORTCUTS.find((rule) => rule.action === action)?.label ?? action;
}

/** Ce que la palette sait de l'état de l'app pour décider ce qui peut agir. */
export type Availability = {
  /** Un dossier est ouvert. */
  root: boolean;
  /** Nature de l'onglet actif, `null` sans onglet. */
  tab: "file" | "server" | "issue" | null;
  /** Type d'aperçu de l'onglet de fichier actif. */
  previewKind: PreviewKind | null;
  /** L'onglet actif a des modifications non enregistrées. */
  dirty: boolean;
};

export function availabilityOf(hasRoot: boolean, activeTab: Tab | null): Availability {
  const tab =
    activeTab === null
      ? null
      : activeTab.server !== undefined
        ? "server"
        : activeTab.issue !== undefined
          ? "issue"
          : "file";
  return {
    root: hasRoot,
    tab,
    previewKind: tab === "file" ? (activeTab?.previewKind ?? null) : null,
    dirty: activeTab?.dirty === true,
  };
}

// Sans dossier ouvert, l'app n'offre que ces actions (le terminal, lui, demande un dossier).
const NO_FOLDER: ReadonlySet<ShortcutAction> = new Set([
  "open-folder",
  "toggle-theme",
  "help",
  "quit",
]);
// Actions du fichier de l'onglet actif.
const NEEDS_FILE_TAB: ReadonlySet<ShortcutAction> = new Set([
  "trash",
  "reveal-in-finder",
  "copy-path",
  "copy-relative-path",
  "reveal-in-tree",
  "close-tab",
  "save",
]);
const NEEDS_PREVIEW_MODES: ReadonlySet<ShortcutAction> = new Set([
  "mode-rendered",
  "mode-split",
  "mode-source",
]);
const PREVIEW_WITH_MODES: ReadonlySet<PreviewKind> = new Set(["markdown", "mermaid", "html"]);

/** Vrai si l'action peut agir dans cet état : sinon la palette ne la liste pas. */
export function isAvailable(action: ShortcutAction, state: Availability): boolean {
  if (NO_FOLDER.has(action)) return true;
  if (!state.root) return false;
  if (NEEDS_FILE_TAB.has(action)) {
    return state.tab === "file" && (action !== "save" || state.dirty);
  }
  if (NEEDS_PREVIEW_MODES.has(action)) {
    return (
      state.tab === "file" &&
      state.previewKind !== null &&
      PREVIEW_WITH_MODES.has(state.previewKind)
    );
  }
  if (action === "server-reload") return state.tab === "server";
  if (action === "issue-reload") return state.tab === "issue";
  return true;
}
