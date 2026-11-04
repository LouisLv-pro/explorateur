// Sortie des pages du terminal, pour qui veut la lire (serveurs locaux : URL du serveur). La page
// publie ses octets ; le texte n'est décodé que si quelqu'un écoute cette page.

type Listener = (text: string) => void;

const listeners = new Map<number, Set<Listener>>();
const decoders = new Map<number, TextDecoder>();

/** Écoute la sortie (texte décodé) de la page `id` ; renvoie la fonction qui arrête l'écoute. */
export function subscribeOutput(id: number, listener: Listener): () => void {
  let set = listeners.get(id);
  if (set === undefined) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(id);
      decoders.delete(id);
    }
  };
}

/** Octets reçus par la page `id` (appelé par `TerminalPage`). */
export function publishOutput(id: number, bytes: Uint8Array): void {
  const set = listeners.get(id);
  if (set === undefined) return;
  let decoder = decoders.get(id);
  if (decoder === undefined) {
    decoder = new TextDecoder();
    decoders.set(id, decoder);
  }
  // `stream` : un caractère UTF-8 coupé entre deux envois est recollé.
  const text = decoder.decode(bytes, { stream: true });
  for (const listener of set) listener(text);
}
