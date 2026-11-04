import { useEffect, useEffectEvent } from "react";
import { shortcutAction, type ShortcutAction } from "./shortcuts";

// Menu, palette (⌘P) ou dialogue Radix ouvert : il garde ses touches, les raccourcis attendent.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Champ de saisie, éditeur CodeMirror ou autre élément `contenteditable`. */
export function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/** Action d'une touche hors de l'arborescence (ses flèches et `↵` sont pris par ses entrées). */
export function globalAction(event: KeyboardEvent): ShortcutAction | null {
  return shortcutAction(event, { inField: isField(event.target), inTree: false });
}

/**
 * Écoute les touches de la fenêtre et passe à `onAction` celles qui ont une action, sauf si un
 * menu, la palette ou un dialogue est ouvert, ou si un composant a déjà pris la touche.
 * `onAction` ne traite que les actions qui le concernent et appelle `preventDefault` lui-même.
 */
export function useShortcuts(onAction: (action: ShortcutAction, event: KeyboardEvent) => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector(OVERLAY) !== null) return;
    const action = globalAction(event);
    if (action !== null) onAction(action, event);
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
