// Raccourcis clavier (docs/specs/raccourcis.md) : table pure, sans React ni DOM. Chaque écouteur
// (Shell, WorkspaceProvider, TreePanel, FilePane, arborescence…) demande ici l'action d'une
// touche et n'exécute que les siennes. La même table donne l'aide et les infobulles.
// Les textes (libellé, groupe, nom des touches) sont lus dans la langue active à chaque accès
// (getters) : la table ne fige jamais la langue du chargement du module.
import i18n from "@/i18n";
import type { en } from "@/i18n/locales/en";

/** Ce que fait un raccourci. */
export type ShortcutAction =
  | "open-folder"
  | "quick-open"
  | "command-palette"
  | "content-search"
  | "help"
  | "quit"
  | "escape"
  | "next-tab"
  | "previous-tab"
  | "history-back"
  | "history-forward"
  | "tab-1"
  | "tab-2"
  | "tab-3"
  | "tab-4"
  | "tab-5"
  | "tab-6"
  | "tab-7"
  | "tab-8"
  | "tab-last"
  | "close-tab"
  | "server-reload"
  | "mode-rendered"
  | "mode-split"
  | "mode-source"
  | "toggle-tree"
  | "toggle-theme"
  | "toggle-outline"
  | "reveal-in-tree"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "tree-previous"
  | "tree-next"
  | "tree-expand"
  | "tree-collapse"
  | "tree-open"
  | "tree-open-pinned"
  | "tree-type-ahead"
  | "tree-new-file"
  | "tree-new-folder"
  | "save"
  | "trash"
  | "reveal-in-finder"
  | "copy-path"
  | "copy-relative-path"
  | "editor-find"
  | "editor-go-to-line"
  | "terminal-toggle"
  | "terminal-toggle-alt"
  | "terminal-new"
  | "terminal-close-page"
  | "terminal-previous"
  | "terminal-next"
  | "terminal-maximize"
  | "terminal-clear"
  | "terminal-find"
  | "terminal-open-link"
  | "git-toggle"
  | "git-next-hunk"
  | "git-previous-hunk"
  | "git-list-previous"
  | "git-list-next"
  | "git-show-diff"
  | "git-open"
  | "git-commit"
  | "git-commit-push"
  | "issues-open"
  | "issue-reload"
  | "issue-create"
  | "browser-toggle";

/** Les champs de `KeyboardEvent` dont la correspondance a besoin. */
export type KeyInput = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type ShortcutContext = {
  /** Le focus est dans un champ (`input`, `textarea`, `select`), l'éditeur ou un `contenteditable`. */
  inField: boolean;
  /** Le focus est sur une entrée de l'arborescence. */
  inTree: boolean;
};

/** Identifiant stable d'un groupe (le titre affiché, lui, suit la langue). */
export type ShortcutGroupId =
  | "general"
  | "tabs"
  | "display"
  | "tree"
  | "file"
  | "editor"
  | "terminal"
  | "git"
  | "issues"
  | "browser";

/** Libellés des actions dans le catalogue : l'identifiant de l'action (`tab-2` partage `tab-1`). */
type ActionLabel = keyof (typeof en)["shortcuts"]["actions"];

type Shortcut = {
  action: ShortcutAction;
  /**
   * `key` : le caractère tapé (`event.key`, en minuscules). `code` : la touche physique
   * (`event.code`), pour les chiffres (AZERTY : `⌘1` donne `&`) et les combinaisons avec `⌥`,
   * qui change le caractère tapé.
   */
  on: { key: string } | { code: string };
  cmd?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  /** Actif quand le focus est dans un champ ou l'éditeur (les raccourcis avec ⌘, sauf ⌘⌫). */
  inField: boolean;
  /** Actif seulement quand le focus est sur une entrée de l'arborescence. */
  tree?: true;
  /**
   * Pris ailleurs (menu natif de `menu.rs`, keymap de l'éditeur, composants Radix et champ de
   * nom) : la ligne ne sert qu'à l'aide, `shortcutAction` ne la renvoie jamais.
   */
  handledBy?:
    "menu" | "editor" | "component" | "terminal" | "git" | "server" | "issues" | "browser";
  /** Ligne `handledBy: "terminal"` active seulement quand le focus est dans le terminal. */
  terminalFocus?: true;
  /** Ligne `handledBy: "git"` active seulement quand le focus est dans le volet Modifications. */
  gitFocus?: true;
  /** Absent de l'aide : une ligne voisine le résume (⌘2 à ⌘8 sous « ⌘1–8 »). */
  hidden?: true;
  /** Groupe de l'aide, par identifiant stable (tri, filtre). */
  groupId: ShortcutGroupId;
  /** Titre du groupe, dans la langue active. */
  readonly group: string;
  /** Libellé de l'action, dans la langue active. */
  readonly label: string;
  /** Touches à afficher, dans la langue active (`Échap` ou `Esc`). */
  readonly keys: string[];
};

/**
 * Une ligne de la table, avant traduction : sans `label` (lu par l'identifiant de l'action, ou
 * `labelAs` quand plusieurs actions partagent un libellé) et `keys` avec les touches en toutes
 * lettres sous forme de jeton (`esc`, `click`).
 */
type Definition = Omit<Shortcut, "group" | "label" | "keys"> & {
  labelAs?: ActionLabel;
  keys: readonly string[];
};

function keyName(key: string): string {
  if (key === "esc") return i18n.t("shortcuts:keys.esc");
  if (key === "click") return i18n.t("shortcuts:keys.click");
  return key;
}

function rule(definition: Definition): Shortcut {
  const { labelAs, keys, ...rest } = definition;
  const labelKey = labelAs ?? (definition.action as ActionLabel);
  return {
    ...rest,
    get group() {
      return i18n.t(`shortcuts:groups.${definition.groupId}`);
    },
    get label() {
      return i18n.t(`shortcuts:actions.${labelKey}`);
    },
    get keys() {
      return keys.map(keyName);
    },
  };
}

const tabRank = (n: number): Definition => ({
  action: `tab-${n}` as ShortcutAction,
  on: { code: `Digit${n}` },
  cmd: true,
  inField: true,
  groupId: "tabs",
  labelAs: "tab-1",
  keys: ["⌘", "1–8"],
  ...(n === 1 ? {} : { hidden: true }),
});

/** Seule source de vérité : `shortcutAction` en tire la correspondance, l'aide son contenu. */
export const SHORTCUTS: readonly Shortcut[] = (
  [
    {
      action: "open-folder",
      on: { key: "o" },
      cmd: true,
      inField: true,
      groupId: "general",
      keys: ["⌘", "O"],
    },
    {
      action: "quick-open",
      on: { key: "p" },
      cmd: true,
      inField: true,
      groupId: "general",
      keys: ["⌘", "P"],
    },
    {
      action: "command-palette",
      on: { key: "p" },
      cmd: true,
      shift: true,
      inField: true,
      groupId: "general",
      keys: ["⇧", "⌘", "P"],
    },
    {
      action: "content-search",
      on: { key: "f" },
      cmd: true,
      shift: true,
      inField: true,
      groupId: "general",
      keys: ["⌘", "⇧", "F"],
    },
    {
      action: "escape",
      on: { key: "escape" },
      inField: true,
      handledBy: "component",
      groupId: "general",
      keys: ["esc"],
    },
    {
      action: "quit",
      on: { key: "q" },
      cmd: true,
      inField: true,
      handledBy: "menu",
      groupId: "general",
      keys: ["⌘", "Q"],
    },
    {
      action: "help",
      on: { key: "?" },
      inField: false,
      groupId: "general",
      keys: ["?"],
    },
    {
      action: "next-tab",
      on: { key: "tab" },
      ctrl: true,
      inField: true,
      groupId: "tabs",
      keys: ["⌃", "Tab"],
    },
    {
      action: "previous-tab",
      on: { key: "tab" },
      ctrl: true,
      shift: true,
      inField: true,
      groupId: "tabs",
      keys: ["⌃", "⇧", "Tab"],
    },
    // Fichier précédent et suivant (spec continuite.md). Pas ⌘[ ni ⌘] : CodeMirror les lie à
    // « désindenter » et « indenter ». Les flèches ont le même `code` sur toutes les dispositions.
    {
      action: "history-back",
      on: { code: "ArrowLeft" },
      ctrl: true,
      cmd: true,
      inField: true,
      groupId: "tabs",
      keys: ["⌃", "⌘", "←"],
    },
    {
      action: "history-forward",
      on: { code: "ArrowRight" },
      ctrl: true,
      cmd: true,
      inField: true,
      groupId: "tabs",
      keys: ["⌃", "⌘", "→"],
    },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(tabRank),
    {
      action: "tab-last",
      on: { code: "Digit9" },
      cmd: true,
      inField: true,
      groupId: "tabs",
      keys: ["⌘", "9"],
    },
    {
      action: "close-tab",
      on: { key: "w" },
      cmd: true,
      inField: true,
      handledBy: "menu",
      groupId: "tabs",
      keys: ["⌘", "W"],
    },
    {
      // Écouté par l'aperçu du serveur affiché (`ServerPane`, `serverAction`).
      action: "server-reload",
      on: { key: "r" },
      cmd: true,
      inField: true,
      handledBy: "server",
      groupId: "tabs",
      keys: ["⌘", "R"],
    },
    {
      action: "mode-rendered",
      on: { code: "Digit1" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "display",
      keys: ["⌥", "⌘", "1"],
    },
    {
      action: "mode-split",
      on: { code: "Digit2" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "display",
      keys: ["⌥", "⌘", "2"],
    },
    {
      action: "mode-source",
      on: { code: "Digit3" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "display",
      keys: ["⌥", "⌘", "3"],
    },
    {
      action: "toggle-tree",
      on: { code: "KeyS" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "display",
      keys: ["⌥", "⌘", "S"],
    },
    {
      action: "toggle-theme",
      on: { key: "l" },
      cmd: true,
      shift: true,
      inField: true,
      groupId: "display",
      keys: ["⇧", "⌘", "L"],
    },
    {
      action: "toggle-outline",
      on: { code: "KeyT" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "display",
      keys: ["⌥", "⌘", "T"],
    },
    // Zoom (docs/specs/zoom.md). `+` et `=` se tapent avec ou sans Maj selon le clavier (voir
    // `matches`) ; la ligne `=` ne sert qu'à la reconnaissance, l'aide montre `+`.
    {
      action: "zoom-in",
      on: { key: "+" },
      cmd: true,
      inField: true,
      groupId: "display",
      keys: ["⌘", "+"],
    },
    {
      action: "zoom-in",
      on: { key: "=" },
      cmd: true,
      inField: true,
      hidden: true,
      groupId: "display",
      keys: ["⌘", "="],
    },
    {
      action: "zoom-out",
      on: { key: "-" },
      cmd: true,
      inField: true,
      groupId: "display",
      keys: ["⌘", "-"],
    },
    {
      action: "zoom-reset",
      on: { code: "Digit0" },
      cmd: true,
      inField: true,
      groupId: "display",
      keys: ["⌘", "0"],
    },
    {
      action: "reveal-in-tree",
      on: { key: "e" },
      cmd: true,
      shift: true,
      inField: true,
      groupId: "tree",
      keys: ["⇧", "⌘", "E"],
    },
    {
      action: "tree-previous",
      on: { key: "arrowup" },
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["↑"],
    },
    {
      action: "tree-next",
      on: { key: "arrowdown" },
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["↓"],
    },
    {
      action: "tree-expand",
      on: { key: "arrowright" },
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["→"],
    },
    {
      action: "tree-collapse",
      on: { key: "arrowleft" },
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["←"],
    },
    {
      action: "tree-open",
      on: { key: "enter" },
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["↵"],
    },
    {
      action: "tree-open-pinned",
      on: { key: "enter" },
      cmd: true,
      inField: false,
      tree: true,
      groupId: "tree",
      keys: ["⌘", "↵"],
    },
    // Aide seule : le saut par frappe est pris par `useTypeAhead` (arborescence/keyboard.ts).
    {
      action: "tree-type-ahead",
      on: { key: "a-z" },
      inField: false,
      tree: true,
      handledBy: "component",
      groupId: "tree",
      keys: ["A–Z"],
    },
    {
      action: "tree-new-file",
      on: { key: "n" },
      cmd: true,
      inField: true,
      groupId: "tree",
      keys: ["⌘", "N"],
    },
    {
      action: "tree-new-folder",
      on: { key: "n" },
      cmd: true,
      shift: true,
      inField: true,
      groupId: "tree",
      keys: ["⇧", "⌘", "N"],
    },
    {
      action: "save",
      on: { key: "s" },
      cmd: true,
      inField: true,
      handledBy: "menu",
      groupId: "file",
      keys: ["⌘", "S"],
    },
    {
      action: "trash",
      on: { code: "Backspace" },
      cmd: true,
      inField: false,
      groupId: "file",
      keys: ["⌘", "⌫"],
    },
    {
      action: "reveal-in-finder",
      on: { code: "KeyR" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "file",
      keys: ["⌥", "⌘", "R"],
    },
    {
      action: "copy-path",
      on: { code: "KeyC" },
      cmd: true,
      alt: true,
      inField: true,
      groupId: "file",
      keys: ["⌥", "⌘", "C"],
    },
    {
      action: "copy-relative-path",
      on: { code: "KeyC" },
      cmd: true,
      alt: true,
      shift: true,
      inField: true,
      groupId: "file",
      keys: ["⌥", "⇧", "⌘", "C"],
    },
    {
      action: "editor-find",
      on: { key: "f" },
      cmd: true,
      inField: true,
      handledBy: "editor",
      groupId: "editor",
      keys: ["⌘", "F"],
    },
    {
      action: "editor-go-to-line",
      on: { code: "KeyG" },
      cmd: true,
      alt: true,
      inField: true,
      handledBy: "editor",
      groupId: "editor",
      keys: ["⌥", "⌘", "G"],
    },
    // Terminal (docs/specs/terminal.md) : `handledBy: "terminal"`, lues par `terminalAction`
    // (le panneau et ses pages), jamais par `shortcutAction`.
    {
      action: "terminal-toggle",
      on: { code: "Backquote" },
      ctrl: true,
      inField: true,
      handledBy: "terminal",
      groupId: "terminal",
      keys: ["⌃", "`"],
    },
    {
      // Même geste par le caractère : ` n'est pas sur la touche Backquote de tous les claviers.
      action: "terminal-toggle",
      on: { key: "`" },
      ctrl: true,
      inField: true,
      handledBy: "terminal",
      hidden: true,
      groupId: "terminal",
      keys: ["⌃", "`"],
    },
    {
      action: "terminal-toggle-alt",
      on: { key: "j" },
      cmd: true,
      inField: true,
      handledBy: "terminal",
      groupId: "terminal",
      keys: ["⌘", "J"],
    },
    {
      action: "terminal-new",
      on: { code: "Backquote" },
      ctrl: true,
      shift: true,
      inField: true,
      handledBy: "terminal",
      groupId: "terminal",
      keys: ["⇧", "⌃", "`"],
    },
    {
      action: "terminal-close-page",
      on: { key: "w" },
      cmd: true,
      inField: true,
      handledBy: "menu",
      groupId: "terminal",
      keys: ["⌘", "W"],
    },
    {
      action: "terminal-previous",
      on: { code: "BracketLeft" },
      cmd: true,
      shift: true,
      inField: true,
      handledBy: "terminal",
      terminalFocus: true,
      groupId: "terminal",
      keys: ["⇧", "⌘", "["],
    },
    {
      action: "terminal-next",
      on: { code: "BracketRight" },
      cmd: true,
      shift: true,
      inField: true,
      handledBy: "terminal",
      terminalFocus: true,
      groupId: "terminal",
      keys: ["⇧", "⌘", "]"],
    },
    {
      action: "terminal-maximize",
      on: { key: "enter" },
      cmd: true,
      shift: true,
      inField: true,
      handledBy: "terminal",
      terminalFocus: true,
      groupId: "terminal",
      keys: ["⇧", "⌘", "↵"],
    },
    {
      action: "terminal-clear",
      on: { key: "k" },
      cmd: true,
      inField: true,
      handledBy: "terminal",
      terminalFocus: true,
      groupId: "terminal",
      keys: ["⌘", "K"],
    },
    // Aide seule : ⌘F est pris par `attachCustomKeyEventHandler` de `TerminalPage`, ⌘clic par
    // les fournisseurs de liens (`linkProviders.ts`).
    {
      action: "terminal-find",
      on: { key: "f" },
      cmd: true,
      inField: true,
      handledBy: "component",
      groupId: "terminal",
      keys: ["⌘", "F"],
    },
    {
      action: "terminal-open-link",
      on: { key: "click" },
      inField: true,
      handledBy: "component",
      groupId: "terminal",
      keys: ["⌘", "click"],
    },
    // Git (docs/specs/git.md) : `handledBy: "git"`, lues par `gitAction` (fournisseur et volet
    // Modifications), jamais par `shortcutAction`. ⌃⇧G : celui de VS Code, sûr en AZERTY.
    {
      action: "git-toggle",
      on: { key: "g" },
      ctrl: true,
      shift: true,
      inField: true,
      handledBy: "git",
      groupId: "git",
      keys: ["⌃", "⇧", "G"],
    },
    {
      action: "git-next-hunk",
      on: { key: "arrowdown" },
      alt: true,
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["⌥", "↓"],
    },
    {
      action: "git-previous-hunk",
      on: { key: "arrowup" },
      alt: true,
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["⌥", "↑"],
    },
    {
      action: "git-list-previous",
      on: { key: "arrowup" },
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["↑"],
    },
    {
      action: "git-list-next",
      on: { key: "arrowdown" },
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["↓"],
    },
    {
      action: "git-show-diff",
      on: { key: "enter" },
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["↵"],
    },
    {
      action: "git-open",
      on: { key: "enter" },
      shift: true,
      inField: false,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["⇧", "↵"],
    },
    // Lot 2 : lu par le champ du message de commit.
    {
      action: "git-commit",
      on: { key: "enter" },
      cmd: true,
      inField: true,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["⌘", "↵"],
    },
    // git-distant.md : commit puis push.
    {
      action: "git-commit-push",
      on: { key: "enter" },
      cmd: true,
      shift: true,
      inField: true,
      handledBy: "git",
      gitFocus: true,
      groupId: "git",
      keys: ["⌘", "⇧", "↵"],
    },
    // Issues GitHub (docs/specs/issues-github.md) : `handledBy: "issues"`, lues par `issueAction`
    // (panneau de gauche, onglet d'issue). ⌃⇧I est laissé à l'app par le terminal.
    {
      action: "issues-open",
      on: { key: "i" },
      ctrl: true,
      shift: true,
      inField: true,
      handledBy: "issues",
      groupId: "issues",
      keys: ["⌃", "⇧", "I"],
    },
    {
      action: "issue-reload",
      on: { key: "r" },
      cmd: true,
      inField: true,
      handledBy: "issues",
      groupId: "issues",
      keys: ["⌘", "R"],
    },
    // Lot 2 : lu par le dialogue de création, affichée dans le groupe Issues de l'aide.
    {
      action: "issue-create",
      on: { key: "enter" },
      cmd: true,
      inField: true,
      handledBy: "issues",
      groupId: "issues",
      keys: ["⌘", "↵"],
    },
    // Navigateur intégré (docs/specs/navigateur.md) : lu par `BrowserProvider` (`browserAction`).
    // ⌃⇧B, sûr en AZERTY ; laissé à l'app par le terminal. Sans effet avec le focus dans la page.
    {
      action: "browser-toggle",
      on: { key: "b" },
      ctrl: true,
      shift: true,
      inField: true,
      handledBy: "browser",
      groupId: "browser",
      keys: ["⌃", "⇧", "B"],
    },
  ] satisfies Definition[]
).map(rule);

/** Une ligne de l'aide. */
export type HelpEntry = { id: string; label: string; keys: readonly string[] };

const GROUP_ORDER: readonly ShortcutGroupId[] = [
  "general",
  "tabs",
  "display",
  "tree",
  "file",
  "editor",
];

/** Un groupe de l'aide : titre et lignes lus dans la langue active à chaque accès. */
export type HelpGroup = {
  id: ShortcutGroupId;
  readonly title: string;
  readonly entries: readonly HelpEntry[];
};

function helpGroup(id: ShortcutGroupId): HelpGroup {
  return {
    id,
    get title() {
      return i18n.t(`shortcuts:groups.${id}`);
    },
    get entries() {
      return SHORTCUTS.filter((item) => item.groupId === id && !item.hidden).map((item) => ({
        id: item.action,
        label: item.label,
        keys: item.keys,
      }));
    },
  };
}

/** Contenu de l'aide, par groupe, dans l'ordre de la spec raccourcis.md. */
export const HELP_GROUPS: readonly HelpGroup[] = GROUP_ORDER.map(helpGroup);

/**
 * Groupe « Terminal » de l'aide (spec terminal.md), affiché après `HELP_GROUPS` : à part, car
 * les tests de raccourcis.md figent la liste des groupes généraux.
 */
export const TERMINAL_HELP_GROUP: HelpGroup = helpGroup("terminal");

/** Groupe « Git » de l'aide (spec git.md), affiché après le groupe Terminal, à part de même. */
export const GIT_HELP_GROUP: HelpGroup = helpGroup("git");

/** Groupe « Issues » de l'aide (spec issues-github.md), après le groupe Git, à part de même. */
export const ISSUES_HELP_GROUP: HelpGroup = helpGroup("issues");

/** Groupe « Navigateur » de l'aide (spec navigateur.md), après le groupe Issues. */
export const BROWSER_HELP_GROUP: HelpGroup = helpGroup("browser");

const SHIFT_AGNOSTIC: ReadonlySet<string> = new Set(["?", "+", "="]);

function matches(rule: Shortcut, input: KeyInput): boolean {
  const sameKey =
    "code" in rule.on ? input.code === rule.on.code : input.key.toLowerCase() === rule.on.key;
  if (!sameKey) return false;
  // `?`, `+` et `=` se tapent avec ou sans Maj selon le clavier (`+` : ⇧= ou pavé numérique).
  const shiftOk =
    ("key" in rule.on && SHIFT_AGNOSTIC.has(rule.on.key)) ||
    input.shiftKey === (rule.shift ?? false);
  return (
    shiftOk &&
    input.metaKey === (rule.cmd ?? false) &&
    input.ctrlKey === (rule.ctrl ?? false) &&
    input.altKey === (rule.alt ?? false)
  );
}

/** L'action d'une combinaison de touches dans ce contexte, ou `null` si elle n'en a aucune. */
export function shortcutAction(input: KeyInput, context: ShortcutContext): ShortcutAction | null {
  const rule = SHORTCUTS.find((candidate) => !candidate.handledBy && matches(candidate, input));
  if (rule === undefined) return null;
  if (rule.tree && !context.inTree) return null;
  if (context.inField && !rule.inField) return null;
  return rule.action;
}

/**
 * Action du terminal d'une combinaison (lignes `handledBy: "terminal"`), ou `null`. Les lignes
 * `terminalFocus` (page suivante, agrandir, effacer…) demandent le focus dans le terminal.
 */
export function terminalAction(
  input: KeyInput,
  context: { inTerminal: boolean },
): ShortcutAction | null {
  const rule = SHORTCUTS.find(
    (candidate) => candidate.handledBy === "terminal" && matches(candidate, input),
  );
  if (rule === undefined) return null;
  if (rule.terminalFocus && !context.inTerminal) return null;
  return rule.action;
}

/**
 * Action du volet Modifications d'une combinaison (lignes `handledBy: "git"`), ou `null`. Les
 * lignes `gitFocus` (blocs, liste) demandent le focus dans le volet.
 */
export function gitAction(input: KeyInput, context: { inPanel: boolean }): ShortcutAction | null {
  const rule = SHORTCUTS.find(
    (candidate) => candidate.handledBy === "git" && matches(candidate, input),
  );
  if (rule === undefined) return null;
  if (rule.gitFocus && !context.inPanel) return null;
  return rule.action;
}

/** Action de l'aperçu d'un serveur local (lignes `handledBy: "server"` : ⌘R), ou `null`. */
export function serverAction(input: KeyInput): ShortcutAction | null {
  const rule = SHORTCUTS.find(
    (candidate) => candidate.handledBy === "server" && matches(candidate, input),
  );
  return rule?.action ?? null;
}

/** Action des issues GitHub d'une combinaison (lignes `handledBy: "issues"` : ⌃⇧I, ⌘R), ou `null`. */
export function issueAction(input: KeyInput): ShortcutAction | null {
  const rule = SHORTCUTS.find(
    (candidate) => candidate.handledBy === "issues" && matches(candidate, input),
  );
  return rule?.action ?? null;
}

/** Action du navigateur intégré d'une combinaison (ligne `handledBy: "browser"` : ⌃⇧B), ou `null`. */
export function browserAction(input: KeyInput): ShortcutAction | null {
  const rule = SHORTCUTS.find(
    (candidate) => candidate.handledBy === "browser" && matches(candidate, input),
  );
  return rule?.action ?? null;
}

/**
 * Vrai si une touche tapée dans le terminal revient à l'app plutôt qu'au shell : toute
 * combinaison avec `⌘` (raccourcis, menu natif, copier-coller), les raccourcis du terminal,
 * ⌃⇧G (volet Modifications) et ⌃⇧I (issues). `⌥` reste la touche de caractères du clavier,
 * jamais Méta : elle va toujours au shell.
 */
export function terminalTakesKey(input: KeyInput): boolean {
  return (
    input.metaKey ||
    terminalAction(input, { inTerminal: true }) !== null ||
    gitAction(input, { inPanel: false }) !== null ||
    issueAction(input) === "issues-open" ||
    browserAction(input) !== null
  );
}

/** Rappel d'un raccourci pour une infobulle : « ⌥⌘1 ». */
export function shortcutHint(action: ShortcutAction): string {
  const rule = SHORTCUTS.find((candidate) => candidate.action === action);
  return rule === undefined ? "" : rule.keys.join("");
}

/** Rang de l'onglet visé par `⌘1` à `⌘8`, `"last"` pour `⌘9`, `null` pour une autre action. */
export function tabRankOf(action: ShortcutAction): number | "last" | null {
  if (action === "tab-last") return "last";
  const match = /^tab-(\d)$/.exec(action);
  return match ? Number(match[1]) : null;
}
