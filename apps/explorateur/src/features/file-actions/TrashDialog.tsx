import { useRef } from "react";
import { useTranslation } from "react-i18next";
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
import type { TrashTarget } from "@/features/workspace/context";

/**
 * Confirmation de mise à la corbeille, montée seulement pendant la demande. Le focus est sur
 * « Mettre à la corbeille » : Entrée confirme, Échap annule (comportement de Radix `AlertDialog`).
 */
export function TrashDialog({
  target,
  unsaved,
  onCancel,
  onConfirm,
}: {
  target: TrashTarget;
  /** Un onglet concerné a des modifications non enregistrées. */
  unsaved: boolean;
  onCancel: () => void;
  onConfirm: (target: TrashTarget) => void;
}) {
  const { t } = useTranslation(["files", "common"]);
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("trash.title", { name: target.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {target.isDir ? t("trash.folder") : t("trash.file")}
            {unsaved && t("trash.unsaved")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            variant="destructive"
            onClick={() => onConfirm(target)}
          >
            {t("trash.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
