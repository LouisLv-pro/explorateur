// Éditeur (features/editor) : bannières, dialogues d'enregistrement, aller à la ligne, bloc git
// et textes internes de CodeMirror (`codemirror`, lus par `EditorState.phrases`).
export const editor = {
  label: "Editor",
  banner: {
    conflict: "This file was modified on disk.",
    reload: "Reload",
    keepMine: "Keep My Changes",
    deleted: "This file was deleted from disk. ⌘S recreates it.",
    denied: "Write denied.",
    folderMissing: "This file's folder no longer exists.",
    failed: "Couldn't save.",
  },
  unsaved: {
    saveTitle: "Save changes to “{{name}}”?",
    saveDescription: "Otherwise, they will be lost.",
    discard: "Don't Save",
    title_one: "{{count}} file has unsaved changes.",
    title_other: "{{count}} files have unsaved changes.",
    description: "Unsaved changes will be lost.",
  },
  goToLine: {
    label: "Go to line…",
  },
  gitBlock: {
    label: "Indexed version of the block",
    absent: "Lines absent from the indexed version.",
    revert: "Revert Block",
    closeTitle: "Close (Esc)",
  },
  // Les valeurs anglaises sont les textes d'origine de CodeMirror.
  codemirror: {
    find: "Find",
    replace: "Replace",
    next: "next",
    previous: "previous",
    all: "all",
    matchCase: "match case",
    byWord: "by word",
    regexp: "regexp",
    replaceOne: "replace",
    replaceAll: "replace all",
    close: "close",
    currentMatch: "current match",
    replacedMatches: "replaced $ matches",
    replacedMatchOnLine: "replaced match on line $",
    onLine: "on line",
    goToLine: "Go to line",
    go: "go",
    controlCharacter: "Control character",
    selectionDeleted: "Selection deleted",
  },
};
