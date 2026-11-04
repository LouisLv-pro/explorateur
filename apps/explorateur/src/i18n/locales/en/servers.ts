// Serveurs locaux et apps natives : bouton et menu, aperçu d'un serveur, sélecteurs d'appareils.
export const servers = {
  button: {
    label: "Servers and Apps",
    labelActive: "Servers and Apps ({{active}} Running)",
    nothing: {
      title: "Nothing to launch",
      hint: "Recognized scripts in package.json: dev, start, preview, serve, storybook, tauri; a configuration in .claude/launch.json; an Xcode project (.xcodeproj, .xcworkspace); or an Electron, Rust (Cargo.toml), Swift (Package.swift) or Flutter (pubspec.yaml) app.",
    },
    servers: "Servers",
    noServer: {
      title: "No server detected",
      hint: "Recognized scripts in package.json: dev, start, preview, serve, storybook; or a configuration in .claude/launch.json.",
    },
    apps: "Apps",
    otherFolders: "Other Folders",
    xcodeMissing: {
      title: "Xcode not found",
      hint: "Check the installation with <0>xcode-select -p</0>",
    },
    flutterMissing: {
      title: "Flutter not found",
      hint: "Check the installation with <0>flutter --version</0>",
    },
    flutterUnreadable: "Couldn't read Flutter devices",
    androidMissing: {
      title: "Android SDK not found",
      hint: "Looked in <0>ANDROID_HOME</0> and <1>~/Library/Android/sdk</1>",
    },
  },
  gesture: {
    launch: "Launch",
    preview: "Preview",
    stop: "Stop",
    terminal: "Show Terminal",
  },
  target: {
    launch: "Launch {{label}}",
    terminal: "Show Terminal for {{label}}",
    stop: "Stop {{label}}",
  },
  status: {
    stopped: "Stopped",
    starting: "Starting…",
    online: "Online",
    elsewhere: "Launched elsewhere",
  },
  appStatus: {
    stopped: "Stopped",
    running: "Running",
  },
  pane: {
    gone: "This server is no longer detected in the folder.",
    address: "Address",
    unknownUrl: "Unknown URL",
    reload: "Reload ({{shortcut}})",
    openInBrowser: "Open in Browser",
    previewOf: "Preview of {{name}}",
    stopped: "Server stopped",
  },
  error: {
    launchFailed: "Couldn't launch: {{detail}}",
    launchFile: "Unreadable file: {{detail}}",
  },
  url: {
    refused: "Only http://localhost and http://127.0.0.1 addresses open in the preview.",
  },
  device: {
    simulator: "Simulator",
    device: "Device",
    androidDevice: "Android Device",
    noSimulator: "No simulator",
    noDevice: "No device",
    noAndroidDevice: "No Android device",
    runtimeMissing: "{{platform}} runtime missing",
    flutterHelp: "Start a simulator or an emulator, then reopen the menu.",
    runtimeHelp: "Install the runtime in Xcode > Settings > Components",
    label: "{{title}} for {{app}}",
    chosen: "{{label}}: {{name}}",
    searching: "Searching…",
    emulator: "emulator",
    plugged: "connected",
  },
};
