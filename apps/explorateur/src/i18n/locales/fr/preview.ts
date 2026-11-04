import type { preview as en } from "../en/preview";

export const preview: typeof en = {
  empty: {
    choose: "Choisissez un fichier dans l'arborescence.",
    quickOpen: "⌘P pour chercher un fichier",
  },
  header: {
    display: "Affichage",
    outlineHint: "Sommaire ({{shortcut}})",
    reload: "Recharger",
    modeHint: "{{mode}} ({{shortcut}})",
  },
  modes: {
    rendered: "Aperçu",
    split: "Scindé",
    source: "Source",
  },
  sourceUnavailable: "Source indisponible : fichier de plus de 2 Mo",
  loading: "Chargement",
  frameTitle: "Aperçu de {{name}}",
  tooLarge: "Fichier trop volumineux pour l'aperçu ({{size}}, limite 2 Mo).",
  binary: "Aperçu indisponible : fichier binaire.",
  readError: {
    notFound: "Ce fichier n'existe plus.",
    permissionDenied: "Accès refusé : macOS n'autorise pas la lecture de ce fichier.",
    notAFile: "Ce chemin est un dossier, pas un fichier.",
    other: "Lecture impossible.",
  },
  image: {
    unreadable: "Image illisible.",
  },
  codeBlock: {
    copy: "Copier",
    copied: "Copié",
    copyCode: "Copier le code",
  },
  size: {
    b: "o",
    kb: "Ko",
    mb: "Mo",
    gb: "Go",
  },
  data: {
    empty: "Fichier vide.",
    label: "Données",
    expandAll: "Tout déplier",
    collapseAll: "Tout replier",
    expand: "Déplier",
    collapse: "Replier",
    invalid: "{{type}} invalide : {{message}}{{place}}",
    atLine: " (ligne {{line}})",
    atLineColumn: " (ligne {{line}}, colonne {{column}})",
    unterminatedQuote: "guillemet non fermé",
  },
  table: {
    // Le français garde « 0 lignes » (pas de forme zéro au singulier dans cette interface).
    rows_zero: "{{n}} lignes",
    rows_one: "{{n}} ligne",
    rows_other: "{{n}} lignes",
    columns_zero: "{{n}} colonnes",
    columns_one: "{{n}} colonne",
    columns_other: "{{n}} colonnes",
    delimiter: "délimiteur {{name}}",
    footer: "{{rows}} · {{columns}} · {{delimiter}}",
    delimiters: {
      comma: "virgule",
      semicolon: "point-virgule",
      tab: "tabulation",
      pipe: "barre verticale",
    },
  },
  outline: {
    title: "Sommaire",
  },
  markdown: {
    openFailed: "Impossible d'ouvrir : {{target}}",
    linkNotFound: "Lien introuvable : {{target}}",
    openIssue: "Ouvrir #{{number}}",
  },
  mermaid: {
    unavailable: "Diagramme indisponible.",
    zoomIn: "Agrandir",
    zoomOut: "Réduire",
    reset: "Réinitialiser",
  },
};
