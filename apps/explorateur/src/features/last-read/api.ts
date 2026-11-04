import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type ReadOutcome } from "@/bindings";
import { readDot, toMarkSets } from "./marks";

/** Pastilles du dossier racine. Relues sur invalidation seulement (`DiskChanged`, lecture). */
export function useReadDot(
  rootPath: string | undefined,
  path: string,
  isDir: boolean,
  open: boolean,
) {
  const { data } = useQuery({
    queryKey: ["read_marks", rootPath],
    queryFn: () => commands.getReadMarks(rootPath ?? ""),
    enabled: rootPath !== undefined,
    staleTime: Infinity,
    select: toMarkSets,
  });
  return readDot(data, path, isDir, open);
}

/** Lecture montrée par le bandeau : changement trouvé, ou fichier jamais lu touché. */
export type ReadNotice = Exclude<ReadOutcome, { kind: "Unchanged" }>;

/** Garde-t-on cette lecture dans le bandeau ? Une lecture sans changement ne l'efface pas. */
function noticeOf(outcome: ReadOutcome): ReadNotice | null {
  if (outcome.kind === "Unchanged") return null;
  if (outcome.kind === "FirstRead" && !outcome.touched) return null;
  return outcome;
}

/**
 * Lecture du fichier d'un volet (spec derniere-lecture.md). Le volet visible est le seul à
 * exécuter ses effets (`<Activity>`) : `mark_read` part quand il devient visible, quand le
 * fichier est relu (`dataUpdatedAt`) et quand la fenêtre reprend le focus, fenêtre active.
 */
export function useLastRead(
  path: string,
  rootPath: string,
  loaded: boolean,
  dataUpdatedAt: number,
) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<ReadNotice | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    const read = () => {
      void commands.markRead(path).then((result) => {
        // Fichier supprimé entre-temps : rien à montrer.
        if (result.status === "ok") {
          const next = noticeOf(result.data);
          if (next) setNotice(next);
        }
        void queryClient.invalidateQueries({ queryKey: ["read_marks", rootPath] });
      });
    };
    if (document.hasFocus()) read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [path, rootPath, loaded, dataUpdatedAt, queryClient]);

  return {
    notice,
    /** Le diff remplace le contenu du volet. */
    showDiff: showDiff && notice?.kind === "Changed",
    toggleDiff: () => setShowDiff((shown) => !shown),
    dismiss: () => {
      setNotice(null);
      setShowDiff(false);
    },
  };
}
