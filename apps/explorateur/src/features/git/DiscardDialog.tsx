// Confirmation de « Annuler les modifications » (docs/specs/git.md, lot 2), d'un fichier ou
// d'un bloc. Le focus est sur le bouton rouge : Entrée confirme, Échap garde les modifications.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FileChange, Hunk } from "@/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isFoldedDir, splitPath } from "./model";

/** Fichier (`hunk` nul) ou bloc à annuler. */
export type DiscardTarget = { change: FileChange; hunk: Hunk | null };

export function DiscardDialog({
  target,
  unsaved,
  onCancel,
  onConfirm,
}: {
  target: DiscardTarget;
  /** Un onglet ouvert sur ce fichier a des modifications non enregistrées. */
  unsaved: boolean;
  onCancel: () => void;
  onConfirm: (target: DiscardTarget) => void;
}) {
  const { t } = useTranslation("git");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { name } = splitPath(target.change.path);
  const untracked = target.change.status === "U";
  const description = [t("discard.lost")];
  if (target.hunk !== null && !untracked) description.push(t("discard.hunkOnly"));
  if (untracked) {
    description.push(
      isFoldedDir(target.change) ? t("discard.untrackedFolder") : t("discard.untrackedFile"),
    );
  }
  if (unsaved) description.push(t("discard.unsaved"));

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("discard.title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{description.join(" ")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("discard.keep")}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            variant="destructive"
            onClick={() => onConfirm(target)}
          >
            {t("action.file.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
