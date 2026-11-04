import type { servers as en } from "../en/servers";

export const servers: typeof en = {
  button: {
    label: "Serveurs et apps",
    labelActive: "Serveurs et apps ({{active}} en cours)",
    nothing: {
      title: "Rien à lancer",
      hint: "Scripts reconnus dans package.json : dev, start, preview, serve, storybook, tauri ; une configuration dans .claude/launch.json ; un projet Xcode (.xcodeproj, .xcworkspace) ; une app Electron, Rust (Cargo.toml), Swift (Package.swift) ou Flutter (pubspec.yaml).",
    },
    servers: "Serveurs",
    noServer: {
      title: "Aucun serveur détecté",
      hint: "Scripts reconnus dans package.json : dev, start, preview, serve, storybook ; ou une configuration dans .claude/launch.json.",
    },
    apps: "Apps",
    otherFolders: "Autres dossiers",
    xcodeMissing: {
      title: "Xcode introuvable",
      hint: "Vérifier l’installation avec <0>xcode-select -p</0>",
    },
    flutterMissing: {
      title: "Flutter introuvable",
      hint: "Vérifier l’installation avec <0>flutter --version</0>",
    },
    flutterUnreadable: "Appareils Flutter illisibles",
    androidMissing: {
      title: "SDK Android introuvable",
      hint: "Cherché dans <0>ANDROID_HOME</0> et <1>~/Library/Android/sdk</1>",
    },
  },
  gesture: {
    launch: "Lancer",
    preview: "Aperçu",
    stop: "Arrêter",
    terminal: "Afficher le terminal",
  },
  target: {
    launch: "Lancer {{label}}",
    terminal: "Afficher le terminal de {{label}}",
    stop: "Arrêter {{label}}",
  },
  status: {
    stopped: "Arrêté",
    starting: "Démarrage…",
    online: "En ligne",
    elsewhere: "Lancé ailleurs",
  },
  appStatus: {
    stopped: "Arrêtée",
    running: "En cours",
  },
  pane: {
    gone: "Ce serveur n'est plus détecté dans le dossier.",
    address: "Adresse",
    unknownUrl: "URL inconnue",
    reload: "Recharger ({{shortcut}})",
    openInBrowser: "Ouvrir dans le navigateur",
    previewOf: "Aperçu de {{name}}",
    stopped: "Serveur arrêté",
  },
  error: {
    launchFailed: "Lancement impossible : {{detail}}",
    launchFile: "Fichier illisible : {{detail}}",
  },
  url: {
    refused: "Seules les adresses http://localhost et http://127.0.0.1 s'ouvrent dans l'aperçu.",
  },
  device: {
    simulator: "Simulateur",
    device: "Appareil",
    androidDevice: "Appareil Android",
    noSimulator: "Aucun simulateur",
    noDevice: "Aucun appareil",
    noAndroidDevice: "Aucun appareil Android",
    runtimeMissing: "Runtime {{platform}} absent",
    flutterHelp: "Démarrez un simulateur ou un émulateur, puis rouvrez le menu.",
    runtimeHelp: "Installer le runtime dans Xcode > Réglages > Composants",
    label: "{{title}} de {{app}}",
    chosen: "{{label}} : {{name}}",
    searching: "Recherche…",
    emulator: "émulateur",
    plugged: "branché",
  },
};
