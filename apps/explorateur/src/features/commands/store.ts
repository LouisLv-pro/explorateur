import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { Command } from "./registry";

/**
 * Commandes enregistrées par les composants (`useCommand`), pour les actions sans raccourci
 * rejouable ou qui n'existent que dans un contexte. Petit magasin externe, comme
 * `editor/documents.ts` : la palette le lit avec `useSyncExternalStore`.
 */
const entries = new Map<string, Command>();
const listeners = new Set<() => void>();
/** Instantané pour `useSyncExternalStore` : même tableau tant que rien ne change. */
let snapshot: readonly Command[] = [];

function commit() {
  snapshot = [...entries.values()];
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRegisteredCommands(): readonly Command[] {
  return snapshot;
}

/** Les commandes enregistrées, dans l'ordre d'enregistrement ; la palette les relit à chaque changement. */
export function useRegisteredCommands(): readonly Command[] {
  return useSyncExternalStore(subscribe, getRegisteredCommands);
}

/**
 * Présente `command` dans la palette tant que le composant est monté et que la valeur n'est pas
 * `null`. `run` peut changer à chaque rendu : la palette lance toujours le dernier.
 */
export function useCommand(command: Command | null): void {
  const key = useId();
  const latest = useRef(command);
  useEffect(() => {
    latest.current = command;
  });

  const id = command?.id;
  const label = command?.label;
  const group = command?.group;
  const shortcut = command?.shortcut;
  useEffect(() => {
    if (id === undefined || label === undefined || group === undefined) {
      if (entries.delete(key)) commit();
      return;
    }
    // `set` garde la place d'une entrée déjà enregistrée : un nouveau libellé ne change pas l'ordre.
    entries.set(key, { id, label, group, shortcut, run: () => latest.current?.run() });
    commit();
  }, [key, id, label, group, shortcut]);

  useEffect(
    () => () => {
      if (entries.delete(key)) commit();
    },
    [key],
  );
}
