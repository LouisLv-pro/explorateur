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
import { Button } from "@/components/ui/button";

/** Fermer un onglet modifié : enregistrer, ne pas enregistrer ou annuler. Focus sur « Enregistrer ». */
export function SaveChangesDialog({
  name,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["editor", "common"]);
  const saveRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          saveRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsaved.saveTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsaved.saveDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={onDiscard}>
            {t("unsaved.discard")}
          </Button>
          <AlertDialogAction ref={saveRef} onClick={onSave}>
            {t("common:save")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Plusieurs fichiers modifiés (« Fermer les autres onglets », quitter l'app) : une seule boîte.
 * Focus sur « Annuler » : la confirmation perd des modifications.
 */
export function UnsavedChangesDialog({
  count,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  count: number;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["editor", "common"]);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsaved.title", { count })}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsaved.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
