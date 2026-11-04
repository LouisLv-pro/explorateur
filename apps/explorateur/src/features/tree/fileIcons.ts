// Icônes de fichier tirées de `material-icon-theme` (docs/decisions/0005-icones-de-fichier.md).
// Imports explicites : seules ces icônes entrent dans le bundle, chacune en fichier `.svg`
// (`no-inline` : Vite mettrait sinon ces petits SVG en URL `data:`). Ajouter un langage = un
// import ici et une ligne dans `BY_NAME` ou `BY_EXTENSION`.
import claude from "material-icon-theme/icons/claude.svg?url&no-inline";
import consoleIcon from "material-icon-theme/icons/console.svg?url&no-inline";
import cIcon from "material-icon-theme/icons/c.svg?url&no-inline";
import cpp from "material-icon-theme/icons/cpp.svg?url&no-inline";
import css from "material-icon-theme/icons/css.svg?url&no-inline";
import database from "material-icon-theme/icons/database.svg?url&no-inline";
import docker from "material-icon-theme/icons/docker.svg?url&no-inline";
import documentIcon from "material-icon-theme/icons/document.svg?url&no-inline";
import editorconfig from "material-icon-theme/icons/editorconfig.svg?url&no-inline";
import eslint from "material-icon-theme/icons/eslint.svg?url&no-inline";
import git from "material-icon-theme/icons/git.svg?url&no-inline";
import go from "material-icon-theme/icons/go.svg?url&no-inline";
import h from "material-icon-theme/icons/h.svg?url&no-inline";
import hpp from "material-icon-theme/icons/hpp.svg?url&no-inline";
import html from "material-icon-theme/icons/html.svg?url&no-inline";
import image from "material-icon-theme/icons/image.svg?url&no-inline";
import java from "material-icon-theme/icons/java.svg?url&no-inline";
import javascript from "material-icon-theme/icons/javascript.svg?url&no-inline";
import json from "material-icon-theme/icons/json.svg?url&no-inline";
import kotlin from "material-icon-theme/icons/kotlin.svg?url&no-inline";
import license from "material-icon-theme/icons/license.svg?url&no-inline";
import lock from "material-icon-theme/icons/lock.svg?url&no-inline";
import log from "material-icon-theme/icons/log.svg?url&no-inline";
import makefile from "material-icon-theme/icons/makefile.svg?url&no-inline";
import markdown from "material-icon-theme/icons/markdown.svg?url&no-inline";
import mdx from "material-icon-theme/icons/mdx.svg?url&no-inline";
import mermaid from "material-icon-theme/icons/mermaid.svg?url&no-inline";
import nodejs from "material-icon-theme/icons/nodejs.svg?url&no-inline";
import pdf from "material-icon-theme/icons/pdf.svg?url&no-inline";
import php from "material-icon-theme/icons/php.svg?url&no-inline";
import pnpm from "material-icon-theme/icons/pnpm.svg?url&no-inline";
import pnpmLight from "material-icon-theme/icons/pnpm_light.svg?url&no-inline";
import prettier from "material-icon-theme/icons/prettier.svg?url&no-inline";
import python from "material-icon-theme/icons/python.svg?url&no-inline";
import react from "material-icon-theme/icons/react.svg?url&no-inline";
import reactTs from "material-icon-theme/icons/react_ts.svg?url&no-inline";
import readme from "material-icon-theme/icons/readme.svg?url&no-inline";
import ruby from "material-icon-theme/icons/ruby.svg?url&no-inline";
import rust from "material-icon-theme/icons/rust.svg?url&no-inline";
import sass from "material-icon-theme/icons/sass.svg?url&no-inline";
import svelte from "material-icon-theme/icons/svelte.svg?url&no-inline";
import svg from "material-icon-theme/icons/svg.svg?url&no-inline";
import swift from "material-icon-theme/icons/swift.svg?url&no-inline";
import table from "material-icon-theme/icons/table.svg?url&no-inline";
import tauri from "material-icon-theme/icons/tauri.svg?url&no-inline";
import toml from "material-icon-theme/icons/toml.svg?url&no-inline";
import tomlLight from "material-icon-theme/icons/toml_light.svg?url&no-inline";
import tsconfig from "material-icon-theme/icons/tsconfig.svg?url&no-inline";
import tune from "material-icon-theme/icons/tune.svg?url&no-inline";
import typescript from "material-icon-theme/icons/typescript.svg?url&no-inline";
import typescriptDef from "material-icon-theme/icons/typescript-def.svg?url&no-inline";
import vite from "material-icon-theme/icons/vite.svg?url&no-inline";
import vitest from "material-icon-theme/icons/vitest.svg?url&no-inline";
import vue from "material-icon-theme/icons/vue.svg?url&no-inline";
import xml from "material-icon-theme/icons/xml.svg?url&no-inline";
import yaml from "material-icon-theme/icons/yaml.svg?url&no-inline";
import zip from "material-icon-theme/icons/zip.svg?url&no-inline";

/** URL du SVG de chaque icône, par nom (celui du fichier dans `material-icon-theme`). */
export const FILE_ICON_URLS: Record<string, string> = {
  c: cIcon,
  claude,
  console: consoleIcon,
  cpp,
  css,
  database,
  docker,
  document: documentIcon,
  editorconfig,
  eslint,
  git,
  go,
  h,
  hpp,
  html,
  image,
  java,
  javascript,
  json,
  kotlin,
  license,
  lock,
  log,
  makefile,
  markdown,
  mdx,
  mermaid,
  nodejs,
  pdf,
  php,
  pnpm,
  prettier,
  python,
  react,
  react_ts: reactTs,
  readme,
  ruby,
  rust,
  sass,
  svelte,
  svg,
  swift,
  table,
  tauri,
  toml,
  tsconfig,
  tune,
  typescript,
  "typescript-def": typescriptDef,
  vite,
  vitest,
  vue,
  xml,
  yaml,
  zip,
};

/**
 * Variante pour le thème clair, quand l'icône d'origine (dessinée pour fond sombre) est presque
 * blanche : `pnpm` et `toml` ont un gris `#e0e0e0` / `#cfd8dc`, invisible sur `canvas`.
 */
export const FILE_ICON_LIGHT_URLS: Partial<Record<string, string>> = {
  pnpm: pnpmLight,
  toml: tomlLight,
};

/** Noms exacts, en minuscules (la casse du nom est ignorée). */
const BY_NAME: Record<string, string> = {
  "package.json": "nodejs",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  "cargo.toml": "rust",
  "cargo.lock": "rust",
  "tsconfig.json": "tsconfig",
  "tauri.conf.json": "tauri",
  dockerfile: "docker",
  makefile: "makefile",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".editorconfig": "editorconfig",
  ".env": "tune",
  "readme.md": "readme",
  license: "license",
  "claude.md": "claude",
};

/** Familles de noms (`tsconfig.app.json`, `vite.config.mts`, `.env.local`…). */
const BY_PATTERN: [RegExp, string][] = [
  [/^tsconfig\..+\.json$/, "tsconfig"],
  [/^vite\.config\.[^.]+$/, "vite"],
  [/^vitest\.config\.[^.]+$/, "vitest"],
  [/^eslint\.config\.[^.]+$/, "eslint"],
  [/^\.prettierrc/, "prettier"],
  [/^\.env\./, "tune"],
];

/** Dernière extension, en minuscules (`d.ts` passe avant `ts`). */
const BY_EXTENSION: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  "d.ts": "typescript-def",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  json: "json",
  jsonc: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  scss: "sass",
  html: "html",
  md: "markdown",
  mdx: "mdx",
  mmd: "mermaid",
  mermaid: "mermaid",
  sh: "console",
  zsh: "console",
  bash: "console",
  py: "python",
  sql: "database",
  swift: "swift",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "h",
  cpp: "cpp",
  hpp: "hpp",
  rb: "ruby",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  svg: "svg",
  lock: "lock",
  txt: "document",
  log: "log",
  csv: "table",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  zip: "zip",
  db: "database",
  sqlite: "database",
};

/**
 * Nom de l'icône d'un fichier (clé de `FILE_ICON_URLS`), ou `null` : l'appelant garde alors
 * l'icône lucide de repli. Nom exact, puis famille de noms, puis extension.
 */
export function fileIconFor(name: string): string | null {
  const lower = name.toLowerCase();
  const exact = BY_NAME[lower];
  if (exact) return exact;
  for (const [pattern, icon] of BY_PATTERN) {
    if (pattern.test(lower)) return icon;
  }
  if (lower.endsWith(".d.ts") && lower.length > ".d.ts".length) return BY_EXTENSION["d.ts"] ?? null;
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[lower.slice(dot + 1)] ?? null;
}
