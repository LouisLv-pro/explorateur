// Faux disque du navigateur simulé : un projet d'exemple et les règles de listage de Rust
// (masquage, tri, type d'aperçu, lecture d'un fichier).
import type {
  AppError,
  ContentSearch,
  DiskChange,
  Entry,
  FileHits,
  FileMatch,
  FilePreview,
  PreviewKind,
} from "@/bindings";
import { ANALYSE_IPYNB, INVALIDE_IPYNB, VIDE_IPYNB } from "./mock-notebooks";

export const HOME = "/Users/alex";
export const DEMO_ROOT = `${HOME}/Projets/demo`;

/** Nœud du faux disque : dossier (avec enfants) ou fichier (contenu facultatif). */
export type FakeNode =
  | { kind: "dir"; children: Record<string, FakeNode>; denied?: boolean }
  | {
      kind: "file";
      content?: string;
      size?: number;
      special?: "tooLarge" | "binary";
      /** Compteur d'écritures : sert de révision (`FilePreview.revision`). */
      rev?: number;
    };

const dir = (children: Record<string, FakeNode> = {}): FakeNode => ({ kind: "dir", children });
const file = (
  content = "",
  extra: { size?: number; special?: "tooLarge" | "binary" } = {},
): FakeNode => ({
  kind: "file",
  content,
  ...extra,
});

const README = `# Démo

Projet d'exemple du navigateur simulé. Voir le [guide](docs/guide.md), la
[section tâches](#tâches) ou le [site de Tauri](https://tauri.app).

![Logo](assets/logo.png)

## Tableau

| Fichier | Rôle | Taille |
| ------- | ---- | ------ |
| main.rs | point d'entrée | 1 Ko |
| App.tsx | interface | 2 Ko |

## Tâches

- [x] Ouvrir un dossier
- [x] Afficher l'arborescence
- [ ] Rechercher un fichier

Suivi : l'issue #12 (terminal), la PR #30, le lien
https://github.com/orbit-labs/demo/issues/9 et \`#12 en code\`, qui reste du code.

Texte avec du \`code en ligne\`, du ~~barré~~, un lien automatique https://example.org
et une note.[^1]

> Une citation sur deux lignes
> pour vérifier le trait.

\`\`\`rust
fn main() {
    println!("bonjour");
}
\`\`\`

---

[^1]: Texte de la note de bas de page.
`;

const GUIDE = `# Guide

Retour au [README](../README.md#tableau).

## Mise en route !

Rien de plus.
`;

// Diagrammes Mermaid (spec diagrammes-mermaid.md) : un flowchart, un camembert, un bloc invalide
// (erreur de Pele) et un bloc `ts` ordinaire, qui reste un bloc de code.
const DIAGRAMMES = [
  "# Diagrammes",
  "",
  "## Flowchart",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Ouvrir un dossier] --> B{Fichier Mermaid ?}",
  "  B -->|oui| C[Dessiner le diagramme]",
  "  B -->|non| D[Afficher le texte]",
  "```",
  "",
  "## Camembert",
  "",
  "```mermaid",
  "pie title Fichiers du dépôt",
  '  "Rust" : 45',
  '  "TypeScript" : 35',
  '  "Markdown" : 20',
  "```",
  "",
  "## Bloc invalide",
  "",
  "```mermaid",
  "ceci n'est pas un diagramme",
  "```",
  "",
  "## Code ordinaire",
  "",
  "```ts",
  "const total: number = 40 + 2;",
  "```",
  "",
  "Le texte après les diagrammes s'affiche normalement.",
  "",
].join("\n");

// Flowchart large : plus large que le panneau, il rétrécit et se zoome (⌘ + molette).
const FLUX_MMD = [
  "flowchart LR",
  "  N1[Ouverture] --> N2[Lecture du dossier]",
  "  N2 --> N3[Tri des entrées]",
  "  N3 --> N4{Dossier ?}",
  "  N4 -->|oui| N5[Arborescence]",
  "  N4 -->|non| N6[Type d'aperçu]",
  "  N6 --> N7[Markdown]",
  "  N6 --> N8[HTML]",
  "  N6 --> N9[Mermaid]",
  "  N6 --> N10[Image]",
  "  N7 --> N11[Rendu GFM]",
  "  N8 --> N12[Iframe sandboxée]",
  "  N9 --> N13[Pele]",
  "  N10 --> N14[Protocole asset]",
  "  N11 --> N15[Pastilles de couleur]",
  "  N13 --> N16[SVG]",
  "  N16 --> N17[Zoom]",
  "  N15 --> N18[Affichage]",
  "  N12 --> N18",
  "  N14 --> N18",
  "  N17 --> N18",
  "  N18 --> N19[Rechargement automatique]",
  "  N19 --> N20[Fin]",
  "",
].join("\n");

const INDEX_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Démo</title>
  </head>
  <body>
    <h1>Démo</h1>
    <img src="assets/logo.png" alt="Logo" />
  </body>
</html>
`;

// Fichiers de données (docs/specs/apercu-donnees.md).
const CLIENTS_CSV = [
  "id,nom,adresse,remarque",
  '1,Camille Dupont,"12 rue des Lilas, Lyon","Client fidèle"',
  '2,Élodie Martin,"4 avenue Foch,\nParis","Dit « bonjour », puis ""merci"""',
  "3,Noah Bernard,8 place Bellecour,",
  "",
].join("\n");

const VENTES_CSV = [
  "produit;quantité;prix;remise",
  "Stylo;120;1,50;0",
  "Cahier;45;3,20;5",
  "Classeur;8;12,00;10",
  "",
].join("\n");

const INVENTAIRE_TSV = [
  "référence\tdésignation\tstock\témplacement",
  "A-001\tVis 4x20\t1500\tAllée 1",
  "A-002\tÉcrou M4\t980\tAllée 1",
  "B-014\tRondelle\t12\tAllée 3",
  "",
].join("\n");

/** CSV de `n` lignes de données, pour éprouver la virtualisation (moins de 2 Mio). */
function bigCsv(n: number): string {
  const lines = ["identifiant,nom,montant,statut"];
  for (let i = 1; i <= n; i += 1) {
    lines.push(`${i},Ligne ${i},${(i * 7.31).toFixed(2)},${i % 3 === 0 ? "en attente" : "payé"}`);
  }
  return `${lines.join("\n")}\n`;
}

const CONFIG_YAML = [
  "# Configuration de démonstration",
  "defauts: &defauts",
  "  hote: localhost",
  "  port: 8080",
  "  options:",
  "    delai: 30",
  "    actif: true",
  "serveur:",
  "  <<: *defauts",
  "  nom: principal",
  "secours: *defauts",
  "etapes:",
  "  - compiler",
  "  - tester",
  "  - publier",
  "",
].join("\n");

const MULTI_YAML = ["nom: premier", "valeur: 1", "---", "nom: second", "valeur: 2", ""].join("\n");

const INVALID_YAML = ["nom: demo", "liste: [un, deux", "autre: 3", ""].join("\n");

const CATALOGUE_JSON = `${JSON.stringify(
  {
    boutique: "Papeterie du Centre",
    ouvert: true,
    rayons: [
      {
        nom: "Écriture",
        articles: [
          { ref: "A-001", libelle: "Stylo bille", prix: 1.5, stock: { total: 120, reserve: 4 } },
          { ref: "A-002", libelle: "Crayon", prix: 0.8, stock: { total: 300, reserve: 0 } },
        ],
      },
      { nom: "Papier", articles: [] },
    ],
    contact: null,
  },
  null,
  2,
)}\n`;

const INVALID_JSON = '{\n  "nom": "demo",\n  "valeurs": [1, 2, 3,],\n}\n';

const demo = dir({
  "README.md": file(README),
  "index.html": file(INDEX_HTML),
  "page2.md": file("# Page 2\n"),
  "page10.md": file("# Page 10\n"),
  ".gitignore": file("node_modules\ntarget\n"),
  docs: dir({
    "guide.md": file(GUIDE),
    "diagrammes.md": file(DIAGRAMMES),
    "flux.mmd": file(FLUX_MMD),
  }),
  src: dir({
    "main.rs": file(
      [
        "//! Point d'entrée de la démo.",
        "",
        "use std::collections::HashMap;",
        "",
        "/// Compte les mots d'un texte.",
        "fn count(text: &str) -> HashMap<&str, usize> {",
        "    let mut counts = HashMap::new();",
        "    for word in text.split_whitespace() {",
        "        *counts.entry(word).or_insert(0) += 1;",
        "    }",
        "    counts",
        "}",
        "",
        "fn main() {",
        '    println!("démo : {:?}", count("a b a"));',
        "}",
        "",
      ].join("\n"),
    ),
    "App.tsx": file("export default function App() {\n  return null;\n}\n"),
    // Dossier non suivi de plus de 50 fichiers (spec gros-depots.md) : le faux dépôt le donne
    // replié, en une seule modification. Dans `src` : le test de la racine fige son contenu.
    "build-fix": dir(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `obj-${String(i + 1).padStart(3, "0")}.o`,
          file(`objet ${i + 1}\n`),
        ]),
      ),
    ),
  }),
  // Image et PDF : sans contenu (le front les lit par le protocole `asset`, absent du navigateur).
  // `gros.log` et `outil.bin` reproduisent les cas `TooLarge` et `Binary` de Rust.
  assets: dir({
    "logo.png": file("", { size: 4096 }),
    "plan.pdf": file("", { size: 52_480 }),
    "gros.log": file("", { size: 3_250_000, special: "tooLarge" }),
    "rapport.html": file("", { size: 4_800_000, special: "tooLarge" }),
    "outil.bin": file("", { size: 20_480, special: "binary" }),
  }),
  // Aperçus de données (spec apercu-donnees.md) : un fichier par cas, valides ou non.
  data: dir({
    "clients.csv": file(CLIENTS_CSV),
    "ventes.csv": file(VENTES_CSV),
    "inventaire.tsv": file(INVENTAIRE_TSV),
    "gros.csv": file(bigCsv(20_000)),
    "config.yaml": file(CONFIG_YAML),
    "multi.yaml": file(MULTI_YAML),
    "invalide.yaml": file(INVALID_YAML),
    "catalogue.json": file(CATALOGUE_JSON),
    "invalide.json": file(INVALID_JSON),
    "vide.csv": file(""),
  }),
  ".git": dir({ HEAD: file("ref: refs/heads/main\n") }),
  node_modules: dir({ react: dir({ "package.json": file("{}\n") }) }),
  prive: { kind: "dir", children: { "secret.txt": file() }, denied: true },
  vide: dir(),
});

/**
 * Projet web des serveurs locaux (spec serveurs-locaux.md), à part de `demo` dont les tests
 * figent le contenu : `pnpm run dev` du faux shell écrit l'URL de Vite.
 */
export const WEB_ROOT = `${HOME}/Projets/web`;

/** `project.pbxproj` réduit au nécessaire de la détection des apps natives (cible, plateformes). */
function pbxproj(target: string, settings: string): string {
  return `// !$*UTF8*$!
{
\tobjects = {
\t\tAA000001 /* ${target} */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tname = ${target};
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
\t\tBB000001 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\t${settings}
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t};
}
`;
}

const web = dir({
  "package.json": file(
    JSON.stringify(
      {
        name: "demo",
        private: true,
        scripts: { dev: "vite", build: "vite build", tauri: "tauri" },
      },
      null,
      2,
    ) + "\n",
  ),
  // Apps natives (spec apps-natives.md) : un projet iOS et un projet iOS + macOS à schéma partagé.
  ios: dir({
    "Demo.xcodeproj": dir({
      "project.pbxproj": file(pbxproj("Demo", "SDKROOT = iphoneos;")),
    }),
  }),
  // Apps Android (spec apps-android.md) : un projet Gradle à un module d'application.
  android: dir({
    "settings.gradle.kts": file('rootProject.name = "Meteo"\ninclude(":app")\n'),
    app: dir({
      "build.gradle.kts": file('plugins {\n    id("com.android.application")\n}\n'),
    }),
  }),
  "pnpm-lock.yaml": file("lockfileVersion: '9.0'\n"),
  "index.html": file('<!doctype html>\n<div id="root"></div>\n'),
  ".claude": dir({
    "launch.json": file(
      JSON.stringify(
        {
          version: "0.0.1",
          configurations: [
            {
              name: "Documentation",
              runtimeExecutable: "pnpm",
              runtimeArgs: ["run", "docs"],
              port: 4321,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    ),
  }),
  apps: dir({
    bureau: dir({
      "Bureau.xcodeproj": dir({
        "project.pbxproj": file(
          pbxproj("Bureau", 'SUPPORTED_PLATFORMS = "iphoneos iphonesimulator macosx";'),
        ),
        xcshareddata: dir({
          xcschemes: dir({
            "Bureau.xcscheme": file(
              '<?xml version="1.0" encoding="UTF-8"?>\n<Scheme>\n</Scheme>\n',
            ),
          }),
        }),
      }),
    }),
    // Plateformes Apple autres que iOS et macOS (spec apps-natives.md) : une montre, puis iOS +
    // tvOS + visionOS + Mac Catalyst (le faux Xcode n'a pas de runtime tvOS).
    montre: dir({
      "Montre.xcodeproj": dir({
        "project.pbxproj": file(pbxproj("Montre", "SDKROOT = watchos;")),
      }),
    }),
    jeux: dir({
      "Jeux.xcodeproj": dir({
        "project.pbxproj": file(
          pbxproj(
            "Jeux",
            'SUPPORTED_PLATFORMS = "iphoneos appletvos xros";\n\t\t\t\tSUPPORTS_MACCATALYST = YES;',
          ),
        ),
      }),
    }),
    site: dir({
      "package.json": file(
        JSON.stringify({ name: "site", scripts: { dev: "vite --port 5174" } }, null, 2) + "\n",
      ),
    }),
  }),
  node_modules: dir({
    vite: dir({ "package.json": file('{"name":"vite","scripts":{"dev":"x"}}\n') }),
  }),
  // Dépendance Swift récupérée par Xcode (spec menu-apps-allege.md) : `SourcePackages` est
  // sauté par la détection, ce projet ne doit pas apparaître dans le menu Apps.
  "build-fix": dir({
    SourcePackages: dir({
      checkouts: dir({
        "Nimbus.swift": dir({
          "Nimbus.xcodeproj": dir({
            "project.pbxproj": file(
              pbxproj("NimbusDemo", 'SUPPORTED_PLATFORMS = "iphoneos macosx";'),
            ),
          }),
        }),
      }),
    }),
  }),
});

/** App Expo (spec apps-react-native.md) : ses dossiers `ios/` et `android/` ne donnent pas
 * d'entrée Xcode ni Gradle à part. */
export const MOBILE_ROOT = `${HOME}/Projets/mobile`;

const mobile = dir({
  "package.json": file(
    JSON.stringify(
      { name: "mobile", dependencies: { expo: "~55.0.0", "react-native": "0.83.0" } },
      null,
      2,
    ) + "\n",
  ),
  "pnpm-lock.yaml": file("lockfileVersion: '9.0'\n"),
  ios: dir({
    "mobile.xcodeproj": dir({
      "project.pbxproj": file(pbxproj("mobile", "SDKROOT = iphoneos;")),
    }),
  }),
  android: dir({
    "settings.gradle": file("rootProject.name = 'mobile'\ninclude ':app'\n"),
    app: dir({ "build.gradle": file('apply plugin: "com.android.application"\n') }),
  }),
});

/**
 * Projet Flutter (spec apps-flutter.md) : `pubspec.yaml` avec `sdk: flutter`, `lib/main.dart`, et
 * les dossiers `ios`, `android` et `web`. Le Runner Xcode de `ios` ne doit pas apparaître comme
 * app Xcode séparée.
 */
export const FLUTTER_ROOT = `${HOME}/Projets/flutter`;

const flutter = dir({
  "pubspec.yaml": file(
    "name: flutter_demo\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n",
  ),
  lib: dir({ "main.dart": file("void main() {}\n") }),
  ios: dir({
    "Runner.xcodeproj": dir({
      "project.pbxproj": file(pbxproj("Runner", "SDKROOT = iphoneos;")),
    }),
  }),
  android: dir({ "build.gradle": file("// Gradle\n") }),
  web: dir({ "index.html": file("<!doctype html>\n") }),
});

/**
 * Apps lancées par une commande (spec apps-commandes.md), à part de `web` dont les tests figent
 * le contenu : une app Electron (son script `start` n'est plus un serveur, `dev` le reste), un
 * package Rust à deux binaires, un package Rust à un binaire, un exemple Rust et une
 * bibliothèque (ni l'un ni l'autre ne s'affichent), un package Swift.
 */
export const COMMANDES_ROOT = `${HOME}/Projets/commandes`;

const cargo = (name: string, extra = "") =>
  `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`;

const commandes = dir({
  "bureau-electron": dir({
    "package.json": file(
      JSON.stringify(
        {
          name: "bureau-electron",
          main: "main.js",
          scripts: { start: "electron .", dev: "vite --port 5180", dist: "electron-builder" },
          devDependencies: { electron: "^33.0.0", "electron-builder": "^25.0.0" },
        },
        null,
        2,
      ) + "\n",
    ),
  }),
  outil: dir({
    "Cargo.toml": file(cargo("outil")),
    src: dir({
      "main.rs": file("fn main() {}\n"),
      bin: dir({ "aide.rs": file("fn main() {}\n") }),
    }),
    examples: dir({
      demo: dir({
        "Cargo.toml": file(cargo("demo")),
        src: dir({ "main.rs": file("fn main() {}\n") }),
      }),
    }),
  }),
  solo: dir({
    "Cargo.toml": file(cargo("solo")),
    src: dir({ "main.rs": file("fn main() {}\n") }),
  }),
  "lib-seule": dir({
    "Cargo.toml": file(cargo("lib-seule")),
    src: dir({ "lib.rs": file("pub fn f() {}\n") }),
  }),
  "cli-swift": dir({
    "Package.swift": file(
      `// swift-tools-version:5.9\nimport PackageDescription\n\nlet package = Package(\n    name: "cli-swift",\n    products: [.executable(name: "salut", targets: ["salut"])],\n    targets: [.executableTarget(name: "salut")]\n)\n`,
    ),
  }),
});

/**
 * Notebooks Jupyter (spec notebook.md), à part de `demo` dont les tests figent le contenu. Le
 * `.venv` n'est qu'un décor : le faux `list_python_envs` répond sans lire le disque.
 */
export const NOTEBOOKS_ROOT = `${HOME}/Projets/notebooks`;

const notebooks = dir({
  "analyse.ipynb": file(ANALYSE_IPYNB),
  "vide.ipynb": file(VIDE_IPYNB),
  "invalide.ipynb": file(INVALIDE_IPYNB),
  ".venv": dir({ bin: dir({ python: file("") }) }),
});

/** Racine du faux disque. */
export const disk: FakeNode = dir({
  Users: dir({
    alex: dir({ Projets: dir({ demo, web, commandes, mobile, flutter, notebooks }) }),
  }),
});

/** Nœud au chemin absolu `path`, ou `undefined`. */
export function findNode(path: string): FakeNode | undefined {
  let node: FakeNode | undefined = disk;
  for (const part of path.split("/").filter(Boolean)) {
    if (node?.kind !== "dir") return undefined;
    node = node.children[part];
  }
  return node;
}

function fail(error: AppError): never {
  throw error;
}

/** Même déduction que `PreviewKind::from_name` en Rust. */
export function previewKindOf(name: string): PreviewKind {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  if (["mmd", "mermaid"].includes(ext)) return "mermaid";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(ext))
    return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "ipynb") return "notebook";
  return "text";
}

const NOISY_DIRS = ["node_modules", "target", "__pycache__"];

export function isHidden(entry: Entry): boolean {
  return entry.name.startsWith(".") || (entry.is_dir && NOISY_DIRS.includes(entry.name));
}

// Casse et accents ignorés, nombres dans l'ordre naturel ; à égalité, l'ordre des octets.
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Même contrat que `tree::list_directory` en Rust. */
export function listFakeDirectory(path: string, showHidden: boolean): Entry[] {
  const node = findNode(path);
  if (!node) fail({ kind: "NotFound", message: path });
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: path });
  if (node.denied) fail({ kind: "PermissionDenied", message: path });
  const base = path === "/" ? "" : path;
  return Object.entries(node.children)
    .map(([name, child]): Entry => {
      const isDir = child.kind === "dir";
      return {
        name,
        path: `${base}/${name}`,
        is_dir: isDir,
        preview_kind: isDir ? null : previewKindOf(name),
      };
    })
    .filter((e) => showHidden || !isHidden(e))
    .sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || compareNames(a.name, b.name));
}

/** Minuscules sans accents, un caractère par caractère d'origine. */
const foldChar = (c: string) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()[0] ?? c;

/** Indices (en caractères) d'une sous-séquence de `query` dans `chars`, ou `null`. */
function subsequence(chars: string[], query: string[], from = 0): number[] | null {
  const found: number[] = [];
  let k = 0;
  for (let i = from; i < chars.length && k < query.length; i++) {
    if (foldChar(chars[i]!) === query[k]) {
      found.push(i);
      k++;
    }
  }
  return k === query.length ? found : null;
}

/**
 * Même contrat que `search::find_files` en Rust. Correspondance simplifiée : sous-séquence
 * insensible à la casse et aux accents, d'abord dans le nom, sinon dans tout le chemin ;
 * le classement favorise le nom, puis les lettres consécutives, puis le chemin court.
 */
export function findFakeFiles(root: string, query: string, showHidden: boolean): FileMatch[] {
  const node = findNode(root);
  if (!node) fail({ kind: "NotFound", message: root });
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: root });
  const wanted = [...query].filter((c) => !/\s/u.test(c)).map(foldChar);
  if (wanted.length === 0) return [];

  const matches: FileMatch[] = [];
  const visit = (dirNode: FakeNode & { kind: "dir" }, dirPath: string, relPrefix: string) => {
    if (dirNode.denied) return;
    for (const [name, child] of Object.entries(dirNode.children)) {
      const isDir = child.kind === "dir";
      if (!showHidden && isHidden({ name, is_dir: isDir } as Entry)) continue;
      const rel = `${relPrefix}${name}`;
      if (child.kind === "dir") {
        visit(child, `${dirPath}/${name}`, `${rel}/`);
        continue;
      }
      const chars = [...rel];
      const nameStart = chars.length - [...name].length;
      const inName = subsequence(chars, wanted, nameStart);
      const matched = inName ?? subsequence(chars, wanted);
      if (!matched) continue;
      const consecutive = matched.filter((m, i) => i > 0 && m === matched[i - 1]! + 1).length;
      const score = (inName ? 100 : 0) + consecutive * 10 - Math.floor(chars.length / 4);
      matches.push({ path: `${dirPath}/${name}`, relative_path: rel, score, matched });
    }
  };
  visit(node, root === "/" ? "" : root, "");

  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.relative_path.length - b.relative_path.length ||
        (a.relative_path < b.relative_path ? -1 : 1),
    )
    .slice(0, 50);
}

/** Même contrat que `preview::open_file` en Rust. */
export function openFakeFile(path: string): FilePreview {
  const node = findNode(path);
  if (!node) fail({ kind: "NotFound", message: path });
  if (node.kind === "dir") fail({ kind: "NotAFile", message: path });
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  const text = node.content ?? "";
  const size = node.size ?? new TextEncoder().encode(text).length;
  const base = { path, name, size, revision: fakeRevision(node) };

  // Comme Rust : une grosse page HTML reste affichable (aperçu sans source).
  if (node.special === "tooLarge" && previewKindOf(name) === "html") {
    return { ...base, content: { kind: "LargeHtml" } };
  }
  if (node.special === "tooLarge") return { ...base, content: { kind: "TooLarge" } };
  if (node.special === "binary") return { ...base, content: { kind: "Binary" } };
  switch (previewKindOf(name)) {
    case "markdown":
      return { ...base, content: { kind: "Markdown", text } };
    case "html":
      return { ...base, content: { kind: "Html", text } };
    case "mermaid":
      return { ...base, content: { kind: "Mermaid", text } };
    case "image":
      return { ...base, content: { kind: "Image" } };
    case "pdf":
      return { ...base, content: { kind: "Pdf" } };
    case "notebook":
      return { ...base, content: { kind: "Notebook", text } };
    case "text":
      return { ...base, content: { kind: "Text", text } };
  }
}

/**
 * Même contrat que `search::search_content` en Rust, simplifié : sous-chaîne littérale, lignes
 * longues non découpées, sans limite de 2 000 occurrences.
 */
export function searchFakeContent(
  root: string,
  query: string,
  caseSensitive: boolean,
  showHidden: boolean,
): ContentSearch {
  const result: ContentSearch = { files: [], total: 0, truncated: false };
  if ([...query].length < 2) return result;
  const node = findNode(root);
  if (!node) fail({ kind: "NotFound", message: root });
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: root });
  const fold = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const needle = [...fold(query)];

  const visit = (dirNode: FakeNode & { kind: "dir" }, dirPath: string, relPrefix: string) => {
    if (dirNode.denied) return;
    for (const [name, child] of Object.entries(dirNode.children)) {
      if (!showHidden && isHidden({ name, is_dir: child.kind === "dir" } as Entry)) continue;
      const rel = `${relPrefix}${name}`;
      if (child.kind === "dir") {
        visit(child, `${dirPath}/${name}`, `${rel}/`);
        continue;
      }
      const kind = previewKindOf(name);
      if (child.special || kind === "image" || kind === "pdf") continue;
      const hits: FileHits["hits"] = [];
      (child.content ?? "").split("\n").forEach((raw, index) => {
        const text = raw.replace(/\r$/, "");
        const chars = [...fold(text)];
        const ranges: [number, number][] = [];
        for (let i = 0; i + needle.length <= chars.length;) {
          if (needle.every((c, k) => chars[i + k] === c)) {
            ranges.push([i, i + needle.length]);
            i += needle.length;
          } else i++;
        }
        if (ranges.length > 0) hits.push({ line: index + 1, text, ranges });
      });
      if (hits.length > 0) {
        result.files.push({ path: `${dirPath}/${name}`, relative_path: rel, hits });
        result.total += hits.reduce((n, h) => n + h.ranges.length, 0);
      }
    }
  };
  visit(node, root === "/" ? "" : root, "");
  result.files.sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));
  return result;
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/**
 * Écrit `text` dans le fichier `path` du faux disque (créé avec ses dossiers parents) et
 * renvoie le lot de changements, comme `classify_changes` en Rust.
 */
export function writeFakeFile(path: string, text: string): DiskChange {
  let node: FakeNode = disk;
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) fail({ kind: "NotAFile", message: path });
  for (const part of parts) {
    if (node.kind !== "dir") fail({ kind: "NotADirectory", message: path });
    node = node.children[part] ??= dir();
  }
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: path });
  node.children[name] = { kind: "file", content: text, rev: nextRev++ };
  return { files: [path], dirs: [parentOf(path)] };
}

/** Chaque écriture donne une révision nouvelle, même après suppression et recréation. */
let nextRev = 1;

/** Révision d'un fichier du faux disque (chaîne opaque, comme en Rust). */
function fakeRevision(node: FakeNode & { kind: "file" }): string {
  return `mock-${node.rev ?? 0}`;
}

/**
 * Même contrat que `files::save_file` en Rust : `Conflict` si la révision a changé, fichier
 * absent recréé si son dossier existe, `NotFound` sinon. Renvoie la nouvelle révision.
 */
export function saveFakeFile(
  path: string,
  text: string,
  revision: string,
): { revision: string; change: DiskChange } {
  const node = findNode(path);
  if (node?.kind === "dir") fail({ kind: "NotAFile", message: path });
  if (node && fakeRevision(node) !== revision) fail({ kind: "Conflict", message: path });
  if (!node && findNode(parentOf(path))?.kind !== "dir") fail({ kind: "NotFound", message: path });
  const change = writeFakeFile(path, text);
  const saved = findNode(path) as FakeNode & { kind: "file" };
  return { revision: fakeRevision(saved), change };
}

/** Supprime `path` (fichier ou dossier) du faux disque et renvoie le lot de changements. */
export function removeFakeNode(path: string): DiskChange {
  const parent = findNode(parentOf(path));
  const name = path.split("/").filter(Boolean).at(-1);
  if (parent?.kind !== "dir" || !name || !(name in parent.children))
    fail({ kind: "NotFound", message: path });
  delete parent.children[name];
  return { files: [path], dirs: [parentOf(path)] };
}

/** Même contrat que `files::validate_name` en Rust. */
export function validateFakeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[/\0]/.test(trimmed))
    fail({ kind: "InvalidName", message: name });
  return trimmed;
}

/** Dossier `dir` du faux disque (`NotFound` / `NotADirectory` comme `ensure_dir` en Rust). */
function findFakeDir(dir: string): FakeNode & { kind: "dir" } {
  const node = findNode(dir);
  if (!node) fail({ kind: "NotFound", message: dir });
  if (node.kind !== "dir") fail({ kind: "NotADirectory", message: dir });
  return node;
}

/** Même contrat que `files::create_file` / `create_dir` : chemin créé et lot de changements. */
export function createFakeEntry(
  dirPath: string,
  name: string,
  kind: "file" | "dir",
): { path: string; change: DiskChange } {
  const clean = validateFakeName(name);
  const parent = findFakeDir(dirPath);
  const path = `${dirPath === "/" ? "" : dirPath}/${clean}`;
  if (clean in parent.children) fail({ kind: "AlreadyExists", message: path });
  parent.children[clean] = kind === "dir" ? dir() : file();
  return { path, change: { files: kind === "file" ? [path] : [], dirs: [dirPath] } };
}

/** Même contrat que `files::rename_entry` : nouveau chemin et lot de changements. */
export function renameFakeEntry(
  path: string,
  newName: string,
): { path: string; change: DiskChange } {
  const clean = validateFakeName(newName);
  const node = findNode(path);
  const parentPath = parentOf(path);
  const oldName = path.split("/").filter(Boolean).at(-1);
  const parent = findNode(parentPath);
  if (!node || parent?.kind !== "dir" || !oldName) fail({ kind: "NotFound", message: path });
  if (clean === oldName) return { path, change: { files: [], dirs: [] } };
  const newPath = `${parentPath === "/" ? "" : parentPath}/${clean}`;
  // APFS ignore la casse : « Notes.md » existe déjà si « notes.md » est une autre entrée.
  const taken = Object.keys(parent.children).some(
    (n) => n !== oldName && n.toLowerCase() === clean.toLowerCase(),
  );
  if (taken || (clean in parent.children && clean !== oldName))
    fail({ kind: "AlreadyExists", message: newPath });
  delete parent.children[oldName];
  parent.children[clean] = node;
  return { path: newPath, change: { files: [path, newPath], dirs: [parentPath] } };
}
