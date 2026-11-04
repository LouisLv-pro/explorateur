// Navigateur simulé : pas de webview native dans Vite. Les commandes `browser_*` répondent
// comme Rust (adresse normalisée, événements d'adresse, de titre et de chargement) ; la zone du
// panneau montre seulement l'adresse. Le contenu des pages ne se vérifie que dans `tauri dev`.
import { events, type AppError, type UrlError } from "@/bindings";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i;

/** Copie de `core::browser::normalize_url` (simplifiée : mêmes règles, mêmes erreurs). */
function normalize(input: string): string {
  const text = input.trim();
  if (text === "") throw invalid({ reason: "empty" });
  const scheme = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(text);
  const isPort = scheme !== null && /^\d+([/?#]|$)/.test(scheme[2] ?? "");
  const isSearch = scheme !== null && !scheme[1]?.includes(".") && /^\s/.test(scheme[2] ?? "");
  if (scheme && !isPort && !isSearch) {
    const name = scheme[1] ?? "";
    if (/^https?$/i.test(name)) return text;
    throw invalid({ reason: "unsupportedScheme", scheme: name });
  }
  const spaced = /\s/.test(text);
  if (!spaced && LOCAL.test(text)) return `http://${text}`;
  if (!spaced && text.includes(".")) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

function invalid(message: UrlError): AppError {
  return { kind: "InvalidUrl", message };
}

/** Webviews « vivantes », pour l'erreur d'un onglet inconnu comme en Rust. */
const live = new Set<string>();

function fakeTitle(url: string): string {
  try {
    return `Page de ${new URL(url).host}`;
  } catch {
    return url;
  }
}

function navigate(id: string, url: string) {
  void events.browserLoading.emit({ id, loading: true });
  void events.browserNavigated.emit({ id, url });
  setTimeout(() => {
    void events.browserTitleChanged.emit({ id, title: fakeTitle(url) });
    void events.browserLoading.emit({ id, loading: false });
  }, 300);
}

function known(id: string) {
  if (!live.has(id)) throw { kind: "Browser", message: `unknown tab: ${id}` } satisfies AppError;
}

export const browserHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  browser_navigate: (args) => {
    const id = args.id as string;
    const url = normalize(args.input as string);
    live.add(id);
    navigate(id, url);
    return url;
  },
  browser_layout: (args) => {
    console.info("[mock] browser_layout", JSON.stringify(args.layout));
    return null;
  },
  browser_close: (args) => {
    live.delete(args.id as string);
    return null;
  },
  browser_back: (args) => {
    known(args.id as string);
    console.info("[mock] browser_back", args.id);
    return null;
  },
  browser_forward: (args) => {
    known(args.id as string);
    console.info("[mock] browser_forward", args.id);
    return null;
  },
  browser_reload: (args) => {
    known(args.id as string);
    console.info("[mock] browser_reload", args.id);
    return null;
  },
};

/** `window.__mockBrowser.newWindow(url)` : une page demande une nouvelle fenêtre. */
export const browserTools = {
  newWindow: (url: string) => void events.browserNewTab.emit({ url }),
};
