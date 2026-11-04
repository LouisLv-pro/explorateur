// Apps natives du navigateur simulé (spec apps-natives.md) : détection simplifiée sur le faux
// disque (projets `.xcodeproj` seuls, sans workspace), simulateurs fixes et commande Xcode
// proche de celle de `core::apps::xcode_command`. `window.__mockServers.noXcode()` fait
// échouer la liste des simulateurs (« Xcode introuvable »), `.xcode()` la rétablit.
// Android, Expo et React Native (specs apps-android.md, apps-react-native.md) : projets Gradle et
// paquets mobiles, trois faux appareils ; `.noAndroidSdk()` fait échouer leur liste, `.androidSdk()`
// la rétablit.
import type {
  AndroidDevice,
  AppError,
  AppTarget,
  FlutterDevice,
  FlutterDevices,
  NativeApp,
  Simulator,
} from "@/bindings";
import { HOME, findNode, type FakeNode } from "./mock-disk";
import { fakeElectronScript, manager, parse, scanFake, text } from "./mock-servers";

// Pas de simulateur tvOS : le runtime n'est pas installé (Lancer désactivé, aide dans le menu).
const SIMULATORS: Simulator[] = [
  { id: "SIM-IPHONE-17", name: "iPhone 17", osVersion: "27.0", booted: true, platform: "ios" },
  {
    id: "SIM-IPHONE-17-PRO",
    name: "iPhone 17 Pro",
    osVersion: "27.0",
    booted: false,
    platform: "ios",
  },
  { id: "SIM-IPAD-AIR", name: "iPad Air", osVersion: "27.0", booted: false, platform: "ios" },
  {
    id: "SIM-WATCH-11",
    name: "Apple Watch Series 11",
    osVersion: "12.0",
    booted: false,
    platform: "watchos",
  },
  {
    id: "SIM-WATCH-ULTRA",
    name: "Apple Watch Ultra 3",
    osVersion: "12.0",
    booted: false,
    platform: "watchos",
  },
  {
    id: "SIM-VISION-PRO",
    name: "Apple Vision Pro",
    osVersion: "27.0",
    booted: false,
    platform: "visionos",
  },
];

let xcodeInstalled = true;

export function setFakeXcode(installed: boolean) {
  xcodeInstalled = installed;
}

export function listFakeSimulators(): Simulator[] {
  if (!xcodeInstalled) {
    const error: AppError = {
      kind: "Io",
      message: 'simctl: xcrun: error: unable to find utility "simctl"',
    };
    throw error;
  }
  return SIMULATORS;
}

const ANDROID_DEVICES: AndroidDevice[] = [
  {
    id: "Pixel_8_API_35",
    name: "Pixel 8 API 35",
    emulator: true,
    avd: "Pixel_8_API_35",
    serial: "emulator-5554",
  },
  {
    id: "Pixel_Tablet_API_35",
    name: "Pixel Tablet API 35",
    emulator: true,
    avd: "Pixel_Tablet_API_35",
    serial: null,
  },
  { id: "R5CT1234ABC", name: "Pixel 7", emulator: false, avd: null, serial: "R5CT1234ABC" },
];

let androidSdkInstalled = true;

export function setFakeAndroidSdk(installed: boolean) {
  androidSdkInstalled = installed;
}

export function listFakeAndroidDevices(): AndroidDevice[] {
  if (!androidSdkInstalled) {
    const error: AppError = { kind: "Failed", message: { reason: "androidSdkNotFound" } };
    throw error;
  }
  return ANDROID_DEVICES;
}

const relative = (root: string, path: string) =>
  path === root ? "." : path.slice(root.length + 1);

const byDirThenName = (a: NativeApp, b: NativeApp) =>
  a.relativeDir === b.relativeDir
    ? a.name < b.name
      ? -1
      : a.name > b.name
        ? 1
        : 0
    : a.relativeDir < b.relativeDir
      ? -1
      : 1;

function xcodeApps(root: string, bundle: string): NativeApp[] {
  const pbx = text(findNode(`${bundle}/project.pbxproj`));
  if (pbx === null) return [];
  const schemesNode: FakeNode | undefined = findNode(`${bundle}/xcshareddata/xcschemes`);
  let schemes =
    schemesNode?.kind === "dir"
      ? Object.keys(schemesNode.children)
          .filter((n) => n.endsWith(".xcscheme"))
          .map((n) => n.slice(0, -".xcscheme".length))
      : [];
  if (schemes.length === 0) {
    schemes = [
      ...pbx.matchAll(
        /isa = PBXNativeTarget;[^}]*?name = ([^;]+);[^}]*?productType = "com\.apple\.product-type\.application"/g,
      ),
    ].map((m) => m[1] ?? "");
  }
  const has = (sdk: string) =>
    new RegExp(`SDKROOT = ${sdk}\\b|SUPPORTED_PLATFORMS = "[^"]*\\b${sdk}\\b`).test(pbx);
  const ios = has("iphoneos");
  const catalyst = ios && /SUPPORTS_MACCATALYST = YES/.test(pbx);
  const platforms = [
    [ios, "ios", "iOS", "iosSimulators"],
    [has("watchos"), "watchos", "watchOS", "watchosSimulators"],
    [has("appletvos"), "tvos", "tvOS", "tvosSimulators"],
    [has("xros"), "visionos", "visionOS", "visionosSimulators"],
    [has("macosx"), "macos", "macOS", null],
    [catalyst, "catalyst", "Mac (Catalyst)", null],
  ] as const;
  if (!platforms.some(([on]) => on)) return [];
  const dir = bundle.slice(0, bundle.lastIndexOf("/"));
  return schemes.map((scheme) => ({
    name: scheme,
    dir,
    relativeDir: relative(root, bundle),
    targets: platforms
      .filter(([on]) => on)
      .map(([, kind, label, deviceSource]) => ({
        id: kind,
        label,
        kind,
        deviceSource,
        project: bundle,
        scheme,
        command: null,
      })),
  }));
}

function tauriApps(root: string, dir: string): NativeApp[] {
  const json = parse(text(findNode(`${dir}/package.json`)));
  const scripts = json?.scripts as Record<string, unknown> | undefined;
  if (!json || typeof scripts !== "object" || scripts === null) return [];
  const name =
    typeof json.name === "string" && json.name !== "" ? json.name : (dir.split("/").at(-1) ?? "");
  const pm = manager(root, dir);
  const targets = Object.entries(scripts)
    .flatMap(([script, value]): AppTarget[] => {
      if (typeof value !== "string") return [];
      const command =
        script === "tauri"
          ? `${pm} run tauri dev`
          : value === "tauri dev" || value.startsWith("tauri dev ")
            ? `${pm} run ${script}`
            : null;
      if (command === null) return [];
      return [
        {
          id: `script:${script}`,
          label: script === "tauri" ? "tauri dev" : script,
          kind: "tauri",
          deviceSource: null,
          project: null,
          scheme: null,
          command,
        },
      ];
    })
    // `tauri` d'abord, puis les autres scripts par nom.
    .sort((a, b) =>
      a.id === "script:tauri" ? -1 : b.id === "script:tauri" ? 1 : a.id < b.id ? -1 : 1,
    );
  if (targets.length === 0) return [];
  return [{ name, dir, relativeDir: relative(root, dir), targets }];
}

/** Plateformes d'une app Flutter, d'après ses dossiers (même ordre que `PLATFORM_DIRS`). */
const FLUTTER_PLATFORMS = ["ios", "android", "macos", "web", "linux", "windows"] as const;
type FlutterPlatform = (typeof FLUTTER_PLATFORMS)[number];

function platformsOf(dir: string): FlutterPlatform[] {
  return FLUTTER_PLATFORMS.filter((p) => findNode(`${dir}/${p}`)?.kind === "dir");
}

/** Une app Flutter : `flutter` sous `dependencies` avec `sdk: flutter`, et `lib/main.dart`. */
function flutterApps(root: string, dir: string): NativeApp[] {
  const pubspec = text(findNode(`${dir}/pubspec.yaml`));
  if (pubspec === null || findNode(`${dir}/lib/main.dart`)?.kind !== "file") return [];
  if (
    !/^dependencies:\s*\n(?:[ \t]+.*\n|\s*\n)*?[ \t]+flutter:\s*\n[ \t]+sdk:\s*flutter/m.test(
      pubspec,
    )
  )
    return [];
  const name = /^name:\s*(\S+)/m.exec(pubspec)?.[1] ?? dir.split("/").at(-1) ?? "";
  return [
    {
      name,
      dir,
      relativeDir: relative(root, dir),
      targets: [
        {
          id: "flutter",
          label: "Flutter",
          kind: "flutter",
          deviceSource: "flutterDevices",
          project: null,
          scheme: null,
          command: null,
        },
      ],
    },
  ];
}

/** Projet Gradle (spec apps-android.md) : une cible par module qui applique
 * `com.android.application`. */
function gradleApp(root: string, dir: string): NativeApp[] {
  const settings =
    text(findNode(`${dir}/settings.gradle.kts`)) ?? text(findNode(`${dir}/settings.gradle`));
  if (settings === null) return [];
  const modules = [...settings.matchAll(/include\s*\(?\s*["']([^"']+)["']/g)]
    .map((m) => m[1] ?? "")
    .filter((module) => {
      const path = `${dir}/${module.replace(/^:/, "").replaceAll(":", "/")}`;
      const build =
        text(findNode(`${path}/build.gradle.kts`)) ?? text(findNode(`${path}/build.gradle`));
      return build?.includes("com.android.application") ?? false;
    });
  if (modules.length === 0) return [];
  const name = /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(settings)?.[1] ?? "";
  const several = modules.length > 1;
  return [
    {
      name: name || (dir.split("/").at(-1) ?? ""),
      dir,
      relativeDir: relative(root, dir),
      targets: modules.map((module) => ({
        id: several ? `android:${module.replace(/^:/, "")}` : "android",
        label: several ? `Android (${module.replace(/^:/, "")})` : "Android",
        kind: "android",
        deviceSource: "androidDevices",
        project: dir,
        scheme: module,
        command: null,
      })),
    },
  ];
}

/** Paquet Expo ou React Native (spec apps-react-native.md) : cibles iOS puis Android. */
function mobileApp(root: string, dir: string): NativeApp | null {
  const json = parse(text(findNode(`${dir}/package.json`)));
  if (!json) return null;
  const deps = {
    ...(json.dependencies as Record<string, unknown> | undefined),
    ...(json.devDependencies as Record<string, unknown> | undefined),
  };
  const expo = "expo" in deps;
  if (!expo && !("react-native" in deps)) return null;
  const pm = manager(root, dir);
  const runner = pm === "npm" ? "npx" : pm;
  const tool = expo ? "expo" : "react-native";
  const kind = expo ? "expo" : "reactNative";
  const run = (platform: "ios" | "android") => (expo ? `run:${platform}` : `run-${platform}`);
  const name =
    typeof json.name === "string" && json.name !== "" ? json.name : (dir.split("/").at(-1) ?? "");
  return {
    name,
    dir,
    relativeDir: relative(root, dir),
    targets: (
      [
        ["ios", "iOS", "iosSimulators"],
        ["android", "Android", "androidDevices"],
      ] as const
    ).map(([platform, label, deviceSource]) => ({
      id: platform,
      label,
      kind,
      deviceSource,
      project: null,
      scheme: `${runner} ${tool} ${run(platform)}`,
      command: null,
    })),
  };
}

// Apps lancées par une commande (apps-commandes.md) : mêmes règles que `core::apps`, version
// simplifiée (binaires de `src/main.rs` et `src/bin`, sans `[[bin]]` ni `default-run`).
const EXCLUDED_DIRS = [
  "examples",
  "example",
  "benches",
  "benchmarks",
  "tests",
  "fixtures",
  "templates",
  "vendor",
  "third_party",
  "pods",
  "carthage",
];
const MAX_PER_PACKAGE = 4;
const MAX_PER_KIND = 12;

const inExcludedDir = (relativePath: string) =>
  relativePath.split("/").some((part) => EXCLUDED_DIRS.includes(part.toLowerCase()));

/** App à une seule cible, lancée par une commande fixe. */
function commandApp(
  name: string,
  dir: string,
  relativeDir: string,
  [id, label, kind]: [string, string, AppTarget["kind"]],
  command: string,
): NativeApp {
  return {
    name,
    dir,
    relativeDir,
    targets: [{ id, label, kind, deviceSource: null, project: null, scheme: null, command }],
  };
}

function electronApp(root: string, dir: string): NativeApp | null {
  const json = parse(text(findNode(`${dir}/package.json`)));
  const scripts = json?.scripts as Record<string, unknown> | undefined;
  if (!json || typeof scripts !== "object" || scripts === null) return null;
  const script = fakeElectronScript(json, scripts);
  if (script === null) return null;
  const name =
    typeof json.name === "string" && json.name !== "" ? json.name : (dir.split("/").at(-1) ?? "");
  return commandApp(
    name,
    dir,
    relative(root, dir),
    [`script:${script}`, "electron", "electron"],
    `${manager(root, dir)} run ${script}`,
  );
}

function rustApps(root: string, dir: string): NativeApp[] {
  const manifest = text(findNode(`${dir}/Cargo.toml`)) ?? "";
  const name = /^\[package\][^[]*?\bname\s*=\s*"([^"]+)"/m.exec(manifest)?.[1];
  if (name === undefined || /^\s*tauri(-build)?\s*=/m.test(manifest)) return [];
  const bins: string[] = [];
  if (findNode(`${dir}/src/main.rs`)) bins.push(name);
  const binDir = findNode(`${dir}/src/bin`);
  if (binDir?.kind === "dir") {
    for (const [entry, node] of Object.entries(binDir.children)) {
      if (node.kind === "file" && entry.endsWith(".rs")) bins.push(entry.slice(0, -3));
      else if (node.kind === "dir" && node.children["main.rs"]) bins.push(entry);
    }
  }
  const alone = bins.length === 1;
  return bins
    .filter((bin) => bin !== "xtask" && !bin.endsWith("-xtask") && !bin.endsWith("_xtask"))
    .sort((a, b) => (a === name ? -1 : b === name ? 1 : a < b ? -1 : 1))
    .slice(0, MAX_PER_PACKAGE)
    .map((bin) =>
      commandApp(
        bin,
        dir,
        relative(root, dir),
        [`bin:${bin}`, "cargo run", "rust"],
        alone ? "cargo run" : `cargo run --bin ${quote(bin)}`,
      ),
    );
}

function swiftApps(root: string, dir: string): NativeApp[] {
  const source = (text(findNode(`${dir}/Package.swift`)) ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
  const names = (call: string) =>
    [...source.matchAll(new RegExp(`\\.${call}\\(\\s*name:\\s*"([^"]+)"`, "g"))].map((m) => m[1]);
  const covered = new Set(
    [...source.matchAll(/\.executable\([^)]*targets:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((t) => t[1]),
    ),
  );
  const products = new Set([
    ...names("executable"),
    ...names("executableTarget").filter((n) => !covered.has(n)),
  ]);
  return [...products]
    .filter((p): p is string => p !== undefined && !/(Tests|Benchmarks?)$/.test(p))
    .sort()
    .slice(0, MAX_PER_PACKAGE)
    .map((product) =>
      commandApp(
        product,
        dir,
        relative(root, dir),
        [`product:${product}`, "swift run", "swift"],
        `swift run ${quote(product)}`,
      ),
    );
}

/** Même contrat que `apps::detect_apps` : Xcode, Gradle, Expo et React Native, Tauri, Electron,
 * Rust, Swift puis Flutter, par chemin puis nom ; les dossiers `ios/` et `android/` d'un paquet
 * mobile ou d'une app Flutter (et son `macos/`) ne comptent pas à part. */
export function detectFakeApps(root: string): NativeApp[] {
  const { packageDirs, pubspecDirs, xcodeBundles, cargoDirs, swiftDirs, gradleDirs } =
    scanFake(root);
  const mobile = packageDirs.flatMap((d) => {
    const app = mobileApp(root, d);
    return app === null ? [] : [app];
  });
  const flutter = pubspecDirs.flatMap((d) => flutterApps(root, d));
  const owned = new Set(mobile.flatMap((a) => [`${a.dir}/ios`, `${a.dir}/android`]));
  const ownedByFlutter = (path: string) =>
    flutter.some((app) =>
      ["ios", "macos", "android"].some(
        (p) => path === `${app.dir}/${p}` || path.startsWith(`${app.dir}/${p}/`),
      ),
    );
  const xcode = xcodeBundles
    .filter(
      (b) =>
        b.endsWith(".xcodeproj") &&
        !owned.has(b.slice(0, b.lastIndexOf("/"))) &&
        !ownedByFlutter(b),
    )
    .flatMap((b) => xcodeApps(root, b))
    .sort(byDirThenName);
  const gradle = gradleDirs
    .filter((d) => !owned.has(d) && !ownedByFlutter(d))
    .flatMap((d) => gradleApp(root, d))
    .sort(byDirThenName);
  const tauri = packageDirs.flatMap((d) => tauriApps(root, d)).sort(byDirThenName);
  const outside = (dir: string) => !inExcludedDir(relative(root, dir));
  const electron = packageDirs
    .filter(outside)
    .flatMap((d) => electronApp(root, d) ?? [])
    .sort(byDirThenName);
  const rust = cargoDirs
    .filter(outside)
    .flatMap((d) => rustApps(root, d))
    .sort(byDirThenName)
    .slice(0, MAX_PER_KIND);
  const xcodeDirs = new Set(xcodeBundles.map((b) => b.slice(0, b.lastIndexOf("/"))));
  const swift = swiftDirs
    .filter((d) => !xcodeDirs.has(d) && outside(d))
    .flatMap((d) => swiftApps(root, d))
    .sort(byDirThenName)
    .slice(0, MAX_PER_KIND);
  return [
    ...xcode,
    ...gradle,
    ...mobile.sort(byDirThenName),
    ...tauri,
    ...electron,
    ...rust,
    ...swift,
    ...flutter,
  ];
}

const FLUTTER_DEVICES: FlutterDevice[] = [
  { id: "SIM-IPHONE-17", name: "iPhone 17", platform: "ios", emulator: true, os: "iOS 27.0" },
  { id: "emulator-5554", name: "Pixel 9", platform: "android", emulator: true, os: "Android 16" },
  { id: "macos", name: "macOS (desktop)", platform: "macos", emulator: false, os: "macOS 27.0" },
  { id: "chrome", name: "Chrome (web)", platform: "web", emulator: false, os: "Google Chrome" },
];

let flutterInstalled = true;
let flutterDevicesStarted = true;

/** Simule Flutter absent (« Flutter introuvable »). */
export function setFakeFlutter(installed: boolean) {
  flutterInstalled = installed;
}

/** Simule l'absence de simulateur ou d'émulateur démarré (liste vide). */
export function setFakeFlutterDevices(started: boolean) {
  flutterDevicesStarted = started;
}

/** Même contrat que `list_flutter_devices` : appareils filtrés par les plateformes de l'app. */
export function listFakeFlutterDevices(dir: string): FlutterDevices {
  if (!flutterInstalled) return { flutterFound: false, devices: [] };
  const platforms = platformsOf(dir);
  return {
    flutterFound: true,
    devices: flutterDevicesStarted
      ? FLUTTER_DEVICES.filter((d) => platforms.includes(d.platform))
      : [],
  };
}

/** Même forme que `get_flutter_command` : chemin absolu de Flutter, puis `run -d <appareil>`. */
export function fakeFlutterCommand(deviceId: string): string {
  if (!flutterInstalled) {
    const error: AppError = { kind: "Failed", message: { reason: "flutterNotFound" } };
    throw error;
  }
  return `${HOME}/flutter/bin/flutter run -d ${quote(deviceId)}`;
}

const quote = (s: string) => (/^[\w/.,@%+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

const SDK = `${HOME}/Library/Android/sdk`;

/** Commande d'une cible Android, Expo ou React Native (forme de `android_command` et
 * `react_native_*_command`, simplifiée). */
function mobileCommand(target: AppTarget, deviceId: string | null): string {
  const base = target.scheme ?? "";
  if (target.deviceSource === "iosSimulators") {
    if (target.kind === "expo") return deviceId === null ? base : `${base} --device ${deviceId}`;
    return `{ ${base.split(" ")[0] ?? "npx"} react-native start & } && ${base}${deviceId === null ? "" : ` --udid ${deviceId}`} --no-packager; fg`;
  }
  const devices = listFakeAndroidDevices();
  const device = devices.find((d) => d.id === deviceId);
  if (device === undefined) {
    const error: AppError = { kind: "Failed", message: { reason: "androidDeviceNotFound" } };
    throw error;
  }
  const adb = `${SDK}/platform-tools/adb`;
  const boot =
    device.serial === null
      ? [`( ${SDK}/emulator/emulator -avd ${device.avd ?? ""} -port 5556 >/dev/null 2>&1 & )`]
      : [];
  const serial = device.serial ?? "emulator-5556";
  if (target.kind === "expo") {
    return `ANDROID_HOME=${SDK} ${base} --device ${device.serial ?? device.avd ?? device.id}`;
  }
  const wait = [`${adb} -s ${serial} wait-for-device`];
  if (target.kind === "reactNative") {
    return `${[...boot, ...wait, `{ ${base.split(" ")[0] ?? "npx"} react-native start & }`, `ANDROID_HOME=${SDK} ${base} --deviceId ${serial} --no-packager`].join(" && ")}; fg`;
  }
  return [
    ...boot,
    ...wait,
    `ANDROID_HOME=${SDK} ANDROID_SERIAL=${serial} gradle ${target.scheme ?? ":app"}:installDebug`,
    `${adb} -s ${serial} shell am start -W -n "$ACT"`,
    `${adb} -s ${serial} logcat --pid="$PID"`,
  ].join(" && ");
}

/** Commande d'une cible (forme de `get_app_command`) : sa commande fixe, sinon celle de
 * `xcode_command` (empreinte simplifiée) ou de `mobileCommand`. */
export function fakeAppCommand(target: AppTarget, simulatorId: string | null): string {
  if (target.command !== null) return target.command;
  if (target.kind === "android" || target.kind === "expo" || target.kind === "reactNative")
    return mobileCommand(target, simulatorId);
  const project = target.project ?? "";
  const flag = project.endsWith(".xcworkspace") ? "-workspace" : "-project";
  const stem =
    project
      .split("/")
      .at(-1)
      ?.replace(/\.\w+$/, "") ?? "";
  const dd = `${HOME}/Library/Caches/app.explorateur.mac/DerivedData/${stem}-mock`;
  const build = (destination: string) =>
    `xcodebuild ${flag} ${quote(project)} -scheme ${quote(target.scheme ?? "")} ` +
    `-configuration Debug -destination ${quote(destination)} -derivedDataPath ${quote(dd)} build`;
  if (target.kind === "macos" || target.kind === "catalyst") {
    const [destination, products] =
      target.kind === "catalyst"
        ? ["platform=macOS,variant=Mac Catalyst", "Debug-maccatalyst"]
        : ["platform=macOS", "Debug"];
    return (
      `${build(destination)} && APP=$(command ls -d ${quote(dd)}/Build/Products/${products}/*.app | head -1) && ` +
      `"$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"`
    );
  }
  const device = simulatorId ?? "booted";
  // SDK de simulateur et nom de plateforme par genre (le dossier de produits visionOS : `xr`).
  const [sdk, platform] = {
    watchos: ["watchsimulator", "watchOS"],
    tvos: ["appletvsimulator", "tvOS"],
    visionos: ["xrsimulator", "visionOS"],
  }[target.kind as "watchos" | "tvos" | "visionos"] ?? ["iphonesimulator", "iOS"];
  return (
    `${build(simulatorId === null ? `generic/platform=${platform} Simulator` : `id=${simulatorId}`)} && ` +
    `xcrun simctl bootstatus ${device} -b && { open -a Simulator 2>/dev/null || open -b com.apple.dt.Devices 2>/dev/null || true; } && ` +
    `APP=$(command ls -d ${quote(dd)}/Build/Products/Debug-${sdk}/*.app | head -1) && ` +
    `xcrun simctl install ${device} "$APP" && ` +
    `xcrun simctl launch --console-pty --terminate-running-process ${device} ` +
    `"$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"`
  );
}
