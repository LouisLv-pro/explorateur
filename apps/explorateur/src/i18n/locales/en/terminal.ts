// Terminal intégré : panneau, pages, recherche, confirmations, erreur de démarrage du shell.
export const terminal = {
  name: "Terminal",
  heightHandle: "Terminal Height",
  heightHint: "Drag to resize, double-click for default height",
  pages: "Terminal Pages",
  newTerminal: "New Terminal",
  restore: "Restore",
  maximize: "Maximize",
  hide: "Hide Terminal",
  withShortcut: "{{label}} ({{shortcut}})",
  running: "{{command}} running",
  newOutput: "new output",
  closePage: "Close {{label}}",
  openIn: "Open in Terminal",
  retry: "Restart",
  startError: {
    notFound: "The shell didn't start: folder not found ({{detail}}).",
    notADirectory: "The shell didn't start: not a folder ({{detail}}).",
    other: "The shell didn't start: {{detail}}",
  },
  search: {
    placeholder: "Search",
    label: "Search in Terminal",
    previous: "Previous (⇧↵)",
    next: "Next (↵)",
    close: "Close Search (Esc)",
  },
  confirm: {
    stopPage: {
      title: "Stop {{command}}?",
      description: "The process running in this page will be stopped.",
      confirm: "Stop",
    },
    unsaved_one: "{{count}} file has unsaved changes.",
    unsaved_other: "{{count}} files have unsaved changes.",
    unsavedLost_one: "{{count}} file has unsaved changes that will be lost.",
    unsavedLost_other: "{{count}} files have unsaved changes that will be lost.",
    quitUnsaved: {
      description: "Unsaved changes will be lost.",
      confirm: "Quit Without Saving",
    },
    quitRunning: {
      title_one: "Stop {{command}} and quit?",
      title_other: "Stop {{count}} processes and quit?",
      description: "Running in the terminal: {{list}}.",
      confirm: "Stop and Quit",
    },
    quitBoth: {
      title: "Quit explorateur?",
      description: "{{files}} Running in the terminal and stopped on quit: {{list}}.",
      confirm: "Quit Without Saving",
    },
  },
  // Faux shell du navigateur simulé (`src/dev/mock-shell.ts`).
  simulatedShell:
    "Simulated browser shell: ls, pwd, echo, sleep [s], exit [code], pnpm run [script].",
};
