import { useEffect, useEffectEvent, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "react-i18next";

/**
 * Écoute le glisser-déposer natif sur la fenêtre. Renvoie `true` pendant le survol ;
 * `onDrop` reçoit les chemins absolus déposés.
 */
export function useFolderDrop(onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handleDrop = useEffectEvent(onDrop);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Un glisser interne à la page (entrée de l'arborescence vers le terminal) n'apporte aucun
    // chemin : ni voile ni ouverture.
    let external = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") {
          external = payload.paths.length > 0;
          setDragging(external);
        } else if (payload.type === "over") {
          if (external) setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else {
          setDragging(false);
          if (payload.paths.length > 0) handleDrop(payload.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return dragging;
}

/** Voile affiché pendant qu'un élément survole la fenêtre. */
export function DropOverlay() {
  const { t } = useTranslation("app");
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-canvas/80 p-6">
      <div className="rounded-md border border-dashed border-hairline-strong bg-canvas px-6 py-4 text-body-md-strong text-ink shadow-level-2">
        {t("folders.dropOverlay")}
      </div>
    </div>
  );
}
