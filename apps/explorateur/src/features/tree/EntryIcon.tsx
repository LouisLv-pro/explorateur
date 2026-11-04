import {
  File,
  FileCode,
  FileImage,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  type LucideProps,
} from "lucide-react";
import type { Entry } from "@/bindings";
import { cn } from "@/lib/utils";
import { FILE_ICON_LIGHT_URLS, FILE_ICON_URLS, fileIconFor } from "./fileIcons";

/** Extensions de code : icône `FileCode` (l'aperçu reste du texte). */
const CODE_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "h",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

function isCode(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Logo d'un fichier (`fileIcons.ts`), 16 px, couleurs d'origine. Décoratif. Une icône presque
 * blanche a sa variante claire, affichée hors du thème sombre.
 */
function FileLogo({ icon, className }: { icon: string; className?: string }) {
  const url = FILE_ICON_URLS[icon];
  const light = FILE_ICON_LIGHT_URLS[icon];
  const base = cn("size-4 shrink-0", className);
  if (!light) return <img src={url} alt="" aria-hidden className={base} />;
  return (
    <>
      <img src={light} alt="" aria-hidden className={cn(base, "dark:hidden")} />
      <img src={url} alt="" aria-hidden className={cn(base, "hidden dark:block")} />
    </>
  );
}

/**
 * Icône d'une entrée : logo du langage ou du rôle du fichier (spec icones-fichiers.md), sinon
 * icône lucide selon le type (dossier ouvert ou fermé, type d'aperçu, code).
 */
export function EntryIcon({
  entry,
  open,
  ...props
}: { entry: Entry; open: boolean } & LucideProps) {
  if (entry.is_dir) return open ? <FolderOpen {...props} /> : <Folder {...props} />;
  const icon = fileIconFor(entry.name);
  if (icon) return <FileLogo icon={icon} className={props.className} />;
  switch (entry.preview_kind) {
    case "markdown":
      return <FileText {...props} />;
    case "html":
      return <FileCode {...props} />;
    case "image":
      return <FileImage {...props} />;
    case "pdf":
      return <FileType {...props} />;
    default:
      return isCode(entry.name) ? <FileCode {...props} /> : <File {...props} />;
  }
}
