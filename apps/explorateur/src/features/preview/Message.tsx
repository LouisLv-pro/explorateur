import type { ReactNode } from "react";

/** Message centré dans la zone d'aperçu (aperçu impossible, erreur, état vide). */
export function Message({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-content-center justify-items-center gap-2 p-6 text-center text-body-sm text-mute">
      {children}
    </div>
  );
}
