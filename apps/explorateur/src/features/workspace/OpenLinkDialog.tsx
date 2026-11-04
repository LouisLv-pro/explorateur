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
import { linkConfirmText } from "./open-target";

/**
 * Un lien ou la commande `explorateur` demande un autre dossier racine (décision 0013 : ouvrir
 * un dossier y lance git). Focus sur « Annuler » (par défaut dans `AlertDialog`).
 */
export function OpenLinkDialog({
  root,
  onConfirm,
  onCancel,
}: {
  root: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const text = linkConfirmText(root);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">
            {text.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("workspace.openLink.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
