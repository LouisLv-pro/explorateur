import type { app as en } from "../en/app";

export const app: typeof en = {
  theme: {
    label: "Thème",
    current: "Thème : {{name}}",
    system: "Système",
    light: "Clair",
    dark: "Sombre",
  },
  showTree: "Afficher l'arborescence",
  widthHandle: "Glisser pour régler la largeur, double-clic : largeur par défaut",
  tabs: {
    list: "Onglets",
    modified: " (modifié)",
    close: "Fermer {{name}}",
    closeOthers: "Fermer les autres onglets",
  },
  commands: {
    title: "Palette de commandes",
    placeholder: "Rechercher une commande…",
    label: "Rechercher une commande",
    list: "Commandes",
    empty: "Aucune commande ne correspond.",
  },
  quickOpen: {
    title: "Rechercher un fichier",
    placeholder: "Rechercher un fichier… (nom:ligne)",
    label: "Rechercher un fichier",
    list: "Fichiers",
    prompt: "Tapez le nom d'un fichier.",
    error: "Recherche impossible.",
    empty: "Aucun fichier ne correspond.",
  },
  zoom: {
    notice: "Zoom {{percent}} %",
  },
  workspace: {
    trashed: "Mis à la corbeille",
    closeWithoutSaving: "Fermer sans enregistrer",
    openLink: {
      title: "Ouvrir le dossier {{name}} ?",
      description: "Un lien ou la commande explorateur demande d'ouvrir {{root}}.",
      confirm: "Ouvrir",
    },
  },
  folders: {
    open: "Ouvrir un dossier…",
    recent: "Récents",
    close: "Fermer le dossier",
    remove: "Retirer",
    dropHint: "Ou glissez un dossier ici.",
    dropOverlay: "Déposer pour ouvrir",
    errors: {
      notFound: "Ce dossier n'existe plus.",
      permissionDenied: "Accès refusé par macOS.",
      notADirectory: "Déposez un dossier, pas un fichier.",
      other: "Impossible d'ouvrir ce dossier.",
    },
  },
};
