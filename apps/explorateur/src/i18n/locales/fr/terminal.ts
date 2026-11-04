import type { terminal as en } from "../en/terminal";

export const terminal: typeof en = {
  name: "Terminal",
  heightHandle: "Hauteur du terminal",
  heightHint: "Glisser pour régler la hauteur, double-clic : hauteur par défaut",
  pages: "Pages du terminal",
  newTerminal: "Nouveau terminal",
  restore: "Rétablir",
  maximize: "Agrandir",
  hide: "Masquer le terminal",
  withShortcut: "{{label}} ({{shortcut}})",
  running: "{{command}} en cours",
  newOutput: "nouvelle sortie",
  closePage: "Fermer {{label}}",
  openIn: "Ouvrir dans le terminal",
  retry: "Relancer",
  startError: {
    notFound: "Le shell n'a pas démarré : dossier introuvable ({{detail}}).",
    notADirectory: "Le shell n'a pas démarré : ce n'est pas un dossier ({{detail}}).",
    other: "Le shell n'a pas démarré : {{detail}}",
  },
  search: {
    placeholder: "Rechercher",
    label: "Rechercher dans le terminal",
    previous: "Précédent (⇧↵)",
    next: "Suivant (↵)",
    close: "Fermer la recherche (Échap)",
  },
  confirm: {
    stopPage: {
      title: "Arrêter {{command}} ?",
      description: "Le processus en cours dans cette page sera arrêté.",
      confirm: "Arrêter",
    },
    unsaved_one: "{{count}} fichier a des modifications non enregistrées.",
    unsaved_other: "{{count}} fichiers ont des modifications non enregistrées.",
    unsavedLost_one: "{{count}} fichier a des modifications non enregistrées, qui seront perdues.",
    unsavedLost_other:
      "{{count}} fichiers ont des modifications non enregistrées, qui seront perdues.",
    quitUnsaved: {
      description: "Les modifications non enregistrées seront perdues.",
      confirm: "Quitter sans enregistrer",
    },
    quitRunning: {
      title_one: "Arrêter {{command}} et quitter ?",
      title_other: "Arrêter {{count}} processus et quitter ?",
      description: "En cours dans le terminal : {{list}}.",
      confirm: "Arrêter et quitter",
    },
    quitBoth: {
      title: "Quitter explorateur ?",
      description: "{{files}} En cours dans le terminal, arrêtés en quittant : {{list}}.",
      confirm: "Quitter sans enregistrer",
    },
  },
  simulatedShell:
    "Faux shell du navigateur simulé : ls, pwd, echo, sleep [s], exit [code], pnpm run [script].",
};
