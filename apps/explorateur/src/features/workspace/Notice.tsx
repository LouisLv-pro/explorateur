import { useEffect, useEffectEvent } from "react";

const NOTICE_MS = 1500;
/** Temps de lecture ajouté par caractère : un message long (avertissement) reste plus longtemps. */
const READ_MS_PER_CHAR = 60;

/** Durée d'affichage : 1,5 s, plus pour un message de plus de 25 caractères. */
export const noticeDuration = (message: string) =>
  Math.max(NOTICE_MS, message.length * READ_MS_PER_CHAR);

/** Message bref en bas de la fenêtre (« Chemin copié »), même présentation que « Lien introuvable ». */
export function Notice({ message, onDone }: { message: string; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  useEffect(() => {
    const timer = setTimeout(done, noticeDuration(message));
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <p
      role="status"
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-body-sm text-on-primary shadow-level-3"
    >
      {message}
    </p>
  );
}
