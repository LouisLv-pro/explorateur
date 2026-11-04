// Dialogue « Définir comme app par défaut » (features/default-app, spec app-par-defaut.md).
export const defaultApp = {
  title: "Make Default for File Types",
  command: "Make Default for File Types…",
  intro:
    "macOS asks for one confirmation per file type. Choose “Use explorateur” in each window. You can stop at any time.",
  loading: "Reading the current state…",
  groups: {
    text: "Markdown and text",
    data: "Data",
    html: "HTML",
    code: "Code",
  },
  status: {
    done: "Done",
    types_one: "{{count}} type",
    types_other: "{{count}} types",
    partial_one: "{{count}} of {{total}} types",
    partial_other: "{{count}} of {{total}} types",
  },
  ask: "Ask macOS ({{total}})",
  close: "Close",
  stop: "Stop",
  allDone: "explorateur already opens all these files.",
  progress: "Confirmation {{current}} of {{total}}: {{extensions}}",
  stopping: "Stopping after the macOS window already open…",
  result: {
    accepted_one: "{{count}} type accepted",
    accepted_other: "{{count}} types accepted",
    refused_one: "{{count}} refused",
    refused_other: "{{count}} refused",
    summary: "{{accepted}}, {{refused}}",
    stopped: "Stopped after {{done}} of {{total}}",
    refusedList: "Refused: {{extensions}}",
  },
};
