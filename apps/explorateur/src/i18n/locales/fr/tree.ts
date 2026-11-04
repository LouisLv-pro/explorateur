import type { tree as en } from "../en/tree";

export const tree: typeof en = {
  panel: {
    tree: "Arborescence",
    search: "Recherche",
    searchHint: "Recherche (⌘⇧F)",
    issues: "Issues",
    issuesHint: "Issues GitHub ({{shortcut}})",
    showHidden: "Afficher les éléments masqués",
    hideHidden: "Masquer les éléments masqués",
    collapseAll: "Tout replier",
    resize: "Redimensionner l'arborescence",
  },
  nameField: {
    newFolder: "Nom du nouveau dossier",
    newFile: "Nom du nouveau fichier",
    rename: "Nouveau nom de {{name}}",
  },
  message: {
    loading: "Chargement",
    denied: "Accès refusé",
    unreadable: "Lecture impossible",
    empty: "Vide",
  },
  menu: {
    newFile: "Nouveau fichier",
    newFolder: "Nouveau dossier",
    rename: "Renommer",
  },
  changes: {
    title: "Contient des modifications",
    label: "Contient des modifications ({{status}})",
  },
};
