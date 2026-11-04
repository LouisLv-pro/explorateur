// URL d'un serveur local (spec serveurs-locaux.md) : lue dans la sortie du terminal, puis
// saisie dans le champ de l'aperçu. Fonctions pures.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** Séquences OSC (`ESC ] … BEL` ou `ESC ] … ESC \`), puis CSI (`ESC [ … lettre`) et autres `ESC x`. */
const ANSI = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}[@-Z\\\\-_]`,
  "g",
);

/** Première URL `http://` vers la machine locale ; le chemin s'arrête aux espaces et guillemets. */
const LOCAL_URL =
  /http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{1,5})?(\/[^\s"'<>`)\]]*)?/;

/** Retire les codes de couleur et de titre d'une sortie de terminal. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * Première URL locale écrite par un serveur (ligne « Local: » de Vite, URL de Next…), ou
 * `null`. Codes de couleur ignorés ; `0.0.0.0` et `[::1]` deviennent `localhost`.
 */
export function findServerUrl(output: string): string | null {
  const match = LOCAL_URL.exec(stripAnsi(output));
  if (!match) return null;
  const [, host = "", port = "", path = ""] = match;
  const shown = host === "0.0.0.0" || host === "[::1]" ? "localhost" : host;
  return `http://${shown}${port}${path === "" ? "/" : path}`;
}

/** Port d'une URL `http` (80 par défaut), `null` si elle est invalide. */
export function portOfUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    return parsed.port === "" ? 80 : Number(parsed.port);
  } catch {
    return null;
  }
}

/**
 * Clé du message de refus (catalogue `servers`) : l'aperçu la traduit au rendu, pour que le
 * message gardé suive un changement de langue.
 */
export const REFUSED_URL_MESSAGE = "servers:url.refused";

export type UrlInput =
  { ok: true; url: string } | { ok: false; message: typeof REFUSED_URL_MESSAGE };

/**
 * URL saisie dans le champ de l'aperçu : un chemin (`/a-propos`) se lit depuis `current`, une
 * URL complète doit viser `localhost` ou `127.0.0.1` en `http`. Sinon : message de refus.
 */
export function resolveServerUrl(input: string, current: string): UrlInput {
  const text = input.trim();
  if (text === "") return { ok: true, url: current };
  let url: URL;
  try {
    url = text.startsWith("/") ? new URL(text, current) : new URL(text);
  } catch {
    return { ok: false, message: REFUSED_URL_MESSAGE };
  }
  if (url.protocol !== "http:" || (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) {
    return { ok: false, message: REFUSED_URL_MESSAGE };
  }
  return { ok: true, url: url.href };
}
