import type { PointerEvent } from "react";
import { useTranslation } from "react-i18next";

/**
 * Poignée gauche d'une colonne de droite : glisser règle la largeur, double-clic la remet par
 * défaut. `onStart` et `onCommit` encadrent le glisser (le navigateur masque sa webview, qui
 * volerait les événements du pointeur).
 */
export function WidthHandle({
  label,
  width,
  onStart,
  onResize,
  onCommit,
  onReset,
}: {
  label: string;
  width: number;
  onStart?: () => void;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("app");

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    onStart?.();
    const startX = event.clientX;
    const startWidth = width;
    let last = startWidth;
    const onMove = (move: globalThis.PointerEvent) => {
      last = startWidth + (startX - move.clientX);
      onResize(last);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      onCommit(last);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      title={t("widthHandle")}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize"
    />
  );
}
