import type { browser as en } from "../en/browser";

export const browser: typeof en = {
  name: "Navigateur",
  widthHandle: "Largeur du navigateur",
  tabs: "Onglets du navigateur",
  newTab: "Nouvel onglet",
  minimize: "Réduire",
  maximize: "Agrandir",
  hide: "Masquer le navigateur ({{shortcut}})",
  withShortcut: "{{label}} ({{shortcut}})",
  loading: "Chargement",
  closeTab: "Fermer {{label}}",
  back: "Précédent",
  forward: "Suivant",
  reload: "Recharger",
  address: "Adresse",
  addressPlaceholder: "Rechercher ou saisir une adresse",
  openDefault: "Ouvrir dans le navigateur par défaut",
  empty: {
    title: "Parcourir le Web",
    hint: "Saisissez une URL",
  },
};
