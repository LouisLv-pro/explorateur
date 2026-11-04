// ⌘+, ⌘- et ⌘0 (docs/specs/zoom.md) : un palier de zoom, ou 100 %, avec un message bref.
import { useEffect, useEffectEvent } from "react";
import i18n from "@/i18n";
import { globalAction } from "@/features/shortcuts/useShortcuts";
import { useWorkspaceActions } from "@/features/workspace/context";
import { applyZoom, currentZoom } from "./appZoom";
import { zoomFor, type ZoomAction } from "./zoom";

function zoomActionOf(action: string | null): ZoomAction | null {
  return action === "zoom-in" || action === "zoom-out" || action === "zoom-reset" ? action : null;
}

/**
 * Écoute les trois raccourcis de zoom. Sans attendre la fermeture des menus ni de la palette :
 * le zoom vaut pour toute la fenêtre. Aux bornes (80 et 200 %) ou déjà à 100 % : rien.
 */
export function useZoomShortcuts(): void {
  const { notify } = useWorkspaceActions();
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const action = zoomActionOf(globalAction(event));
    if (action === null) return;
    event.preventDefault();
    const target = zoomFor(action, currentZoom());
    if (target === currentZoom()) return;
    void applyZoom(target).then(() => {
      notify(i18n.t("app:zoom.notice", { percent: currentZoom() }));
    });
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
