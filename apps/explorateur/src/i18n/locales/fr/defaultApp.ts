import type { defaultApp as en } from "../en/defaultApp";

export const defaultApp: typeof en = {
  title: "Définir comme app par défaut",
  command: "Définir comme app par défaut…",
  intro:
    "macOS demande une confirmation par type de fichier. Choisissez « Utiliser explorateur » dans chaque fenêtre. Vous pouvez arrêter à tout moment.",
  loading: "Lecture de l'état actuel…",
  groups: {
    text: "Markdown et texte",
    data: "Données",
    html: "HTML",
    code: "Code",
  },
  status: {
    done: "Fait",
    types_one: "{{count}} type",
    types_other: "{{count}} types",
    partial_one: "{{count}} type sur {{total}}",
    partial_other: "{{count}} types sur {{total}}",
  },
  ask: "Demander à macOS ({{total}})",
  close: "Fermer",
  stop: "Arrêter",
  allDone: "explorateur ouvre déjà tous ces fichiers.",
  progress: "Confirmation {{current}} sur {{total}} : {{extensions}}",
  stopping: "Arrêt après la fenêtre de macOS déjà ouverte…",
  result: {
    accepted_one: "{{count}} type accepté",
    accepted_other: "{{count}} types acceptés",
    refused_one: "{{count}} refusé",
    refused_other: "{{count}} refusés",
    summary: "{{accepted}}, {{refused}}",
    stopped: "Arrêté après {{done}} sur {{total}}",
    refusedList: "Refusés : {{extensions}}",
  },
};
