import type { editor as en } from "../en/editor";

export const editor: typeof en = {
  label: "Éditeur",
  banner: {
    conflict: "Ce fichier a été modifié sur le disque.",
    reload: "Recharger",
    keepMine: "Garder mes modifications",
    deleted: "Ce fichier a été supprimé du disque. ⌘S le recrée.",
    denied: "Écriture refusée.",
    folderMissing: "Le dossier de ce fichier n'existe plus.",
    failed: "Enregistrement impossible.",
  },
  unsaved: {
    saveTitle: "Enregistrer les modifications de « {{name}} » ?",
    saveDescription: "Sinon, elles seront perdues.",
    discard: "Ne pas enregistrer",
    title_one: "{{count}} fichier a des modifications non enregistrées.",
    title_other: "{{count}} fichiers ont des modifications non enregistrées.",
    description: "Les modifications non enregistrées seront perdues.",
  },
  goToLine: {
    label: "Aller à la ligne…",
  },
  gitBlock: {
    label: "Version indexée du bloc",
    absent: "Lignes absentes de la version indexée.",
    revert: "Annuler ce bloc",
    closeTitle: "Fermer (Échap)",
  },
  codemirror: {
    find: "Rechercher",
    replace: "Remplacer",
    next: "suivant",
    previous: "précédent",
    all: "tout",
    matchCase: "casse",
    byWord: "mot entier",
    regexp: "expression régulière",
    replaceOne: "remplacer",
    replaceAll: "tout remplacer",
    close: "fermer",
    currentMatch: "occurrence courante",
    replacedMatches: "$ occurrences remplacées",
    replacedMatchOnLine: "occurrence remplacée ligne $",
    onLine: "ligne",
    goToLine: "Aller à la ligne",
    go: "aller",
    // Absents de l'ancienne table : CodeMirror les affichait en anglais.
    controlCharacter: "Caractère de contrôle",
    selectionDeleted: "Sélection supprimée",
  },
};
