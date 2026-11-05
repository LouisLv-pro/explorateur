/** Langage Shiki par extension (en minuscules). */
const BY_EXTENSION: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  // Notebook Jupyter : sa source (mode Source) est du JSON.
  ipynb: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  html: "html",
  md: "markdown",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  py: "python",
  sql: "sql",
  swift: "swift",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "cpp",
  xml: "xml",
  svg: "xml",
};

/** Noms de fichier sans extension utile, comparés tels quels. */
const BY_NAME: Record<string, string> = {
  Dockerfile: "docker",
  Makefile: "make",
  "Cargo.lock": "toml",
};

/** Langage de coloration d'un fichier d'après son nom, ou `null` (texte brut). */
export function languageFor(name: string): string | null {
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
