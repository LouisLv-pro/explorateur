// Coque de l'app : thème, onglets, palettes, espace de travail, accueil et composants communs.
export const app = {
  theme: {
    label: "Theme",
    current: "Theme: {{name}}",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  showTree: "Show tree",
  widthHandle: "Drag to resize, double-click for default width",
  tabs: {
    list: "Tabs",
    modified: " (modified)",
    close: "Close {{name}}",
    closeOthers: "Close Other Tabs",
  },
  commands: {
    title: "Command palette",
    placeholder: "Search a command…",
    label: "Search a command",
    list: "Commands",
    empty: "No matching command.",
  },
  quickOpen: {
    title: "Find a file",
    placeholder: "Find a file… (name:line)",
    label: "Find a file",
    list: "Files",
    prompt: "Type a file name.",
    error: "Search failed.",
    empty: "No matching file.",
  },
  zoom: {
    notice: "Zoom {{percent}}%",
  },
  workspace: {
    trashed: "Moved to Trash",
    closeWithoutSaving: "Close Without Saving",
    openLink: {
      title: "Open folder {{name}}?",
      description: "A link or the explorateur command asks to open {{root}}.",
      confirm: "Open",
    },
  },
  folders: {
    open: "Open Folder…",
    recent: "Recent",
    close: "Close Folder",
    remove: "Remove",
    dropHint: "Or drag a folder here.",
    dropOverlay: "Drop to open",
    errors: {
      notFound: "This folder no longer exists.",
      permissionDenied: "Access denied by macOS.",
      notADirectory: "Drop a folder, not a file.",
      other: "Unable to open this folder.",
    },
  },
};
