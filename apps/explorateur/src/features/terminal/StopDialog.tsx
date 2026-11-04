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
import type { ConfirmText } from "./confirm";

/**
 * Arrêter un processus en cours (fermer une page, quitter l'app). Focus sur « Annuler » (par
 * défaut dans `AlertDialog`) : la confirmation arrête des processus.
 */
export function StopDialog({
  text,
  onConfirm,
  onCancel,
  restoreFocus,
}: {
  text: ConfirmText;
  onConfirm: () => void;
  onCancel: () => void;
  /** Rend le focus ailleurs qu'à l'élément d'origine (le terminal plutôt qu'un bouton). */
  restoreFocus?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        onCloseAutoFocus={
          restoreFocus &&
          ((event) => {
            event.preventDefault();
            restoreFocus();
          })
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {text.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
