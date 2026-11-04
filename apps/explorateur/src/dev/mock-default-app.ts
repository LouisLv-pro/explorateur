// Simule `default_app_status` et `set_default_app` (spec app-par-defaut.md) : la table des
// groupes de `core/src/default_app`, avec les UTI de macOS. État de départ : Texte fait, Données
// 3 types sur 8, HTML et Code à faire. `set_default_app` répond après 300 ms et accepte, sauf les
// UTI de `window.__mockDefaultApp.refuse`. `?notBundled=1` : les deux commandes rendent `NotBundled`.
import type { AppError, Group, GroupStatus, PendingType } from "@/bindings";

type Handler = (args: Record<string, unknown>) => unknown;

/** Réglage du navigateur simulé : `window.__mockDefaultApp.refuse = ["public.yaml"]`. */
export type MockDefaultApp = { refuse: string[] };
export const mockDefaultApp: MockDefaultApp = { refuse: [] };

/** Extension et UTI, dans l'ordre de la table. */
const TABLE: readonly (readonly [Group, readonly (readonly [string, string])[]])[] = [
  [
    "text",
    [
      ["md", "net.daringfireball.markdown"],
      ["markdown", "net.daringfireball.markdown"],
      ["txt", "public.plain-text"],
      ["log", "com.apple.log"],
    ],
  ],
  [
    "data",
    [
      ["csv", "public.comma-separated-values-text"],
      ["json", "public.json"],
      ["jsonc", "app.explorateur.mac.jsonc"],
      ["yaml", "public.yaml"],
      ["yml", "public.yaml"],
      ["toml", "public.toml"],
      ["xml", "public.xml"],
      ["ini", "public.ini-source"],
      ["conf", "app.explorateur.mac.conf"],
    ],
  ],
  [
    "html",
    [
      ["html", "public.html"],
      ["htm", "public.html"],
    ],
  ],
  [
    "code",
    [
      ["ts", "public.typescript-source"],
      ["tsx", "public.tsx-source"],
      ["js", "com.netscape.javascript-source"],
      ["jsx", "app.explorateur.mac.jsx"],
      ["mjs", "com.netscape.javascript-source"],
      ["cjs", "app.explorateur.mac.cjs"],
      ["rs", "app.explorateur.mac.rs"],
      ["py", "public.python-script"],
      ["swift", "public.swift-source"],
      ["kt", "app.explorateur.mac.kt"],
      ["go", "app.explorateur.mac.go"],
      ["rb", "public.ruby-script"],
      ["php", "public.php-script"],
      ["java", "com.sun.java-source"],
      ["c", "public.c-source"],
      ["h", "public.c-header"],
      ["cpp", "public.c-plus-plus-source"],
      ["hpp", "public.c-plus-plus-header"],
      ["cs", "app.explorateur.mac.cs"],
      ["sh", "public.shell-script"],
      ["bash", "public.bash-script"],
      ["zsh", "public.zsh-script"],
      ["css", "public.css"],
      ["scss", "app.explorateur.mac.scss"],
      ["sql", "public.sql-source"],
      ["lua", "app.explorateur.mac.lua"],
      ["vue", "app.explorateur.mac.vue"],
      ["svelte", "app.explorateur.mac.svelte"],
    ],
  ],
];

/** UTI déjà ouverts par explorateur au départ : tout le texte, trois types de données. */
const START_DEFAULT: readonly string[] = [
  "net.daringfireball.markdown",
  "public.plain-text",
  "com.apple.log",
  "public.comma-separated-values-text",
  "public.json",
  "public.xml",
];

const defaulted = new Set<string>(START_DEFAULT);

function notBundled(): void {
  if (new URLSearchParams(window.location.search).get("notBundled") === "1") {
    const error: AppError = { kind: "NotBundled" };
    throw error;
  }
}

/** Même contrat que `default_app::group_statuses` en Rust. */
export function fakeDefaultAppStatus(): GroupStatus[] {
  notBundled();
  return TABLE.map(([group, entries]) => {
    const utis = new Set(entries.map(([, uti]) => uti));
    const pending: PendingType[] = [];
    for (const uti of utis) {
      if (defaulted.has(uti)) continue;
      pending.push({
        uti,
        extensions: entries.filter(([, u]) => u === uti).map(([ext]) => ext),
      });
    }
    return {
      group,
      extensions: entries.map(([ext]) => ext),
      types: utis.size,
      defaultTypes: utis.size - pending.length,
      pending,
    };
  });
}

/** Répond après 300 ms (la fenêtre de macOS) : accepte, sauf les UTI de `refuse`. */
export async function fakeSetDefaultApp(uti: string): Promise<boolean> {
  notBundled();
  const known = TABLE.some(([, entries]) => entries.some(([, u]) => u === uti));
  if (!known) {
    const error: AppError = { kind: "NotFound", message: uti };
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (mockDefaultApp.refuse.includes(uti)) return false;
  defaulted.add(uti);
  return true;
}

export const defaultAppHandlers: Record<string, Handler> = {
  default_app_status: () => fakeDefaultAppStatus(),
  set_default_app: (args) => fakeSetDefaultApp(args.uti as string),
};
