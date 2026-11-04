import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useTerminalActions } from "./context";

/** « Ouvrir dans le terminal » : nouvelle page dans le dossier (le parent d'un fichier). */
export function OpenInTerminalItem({ path, isDir }: { path: string; isDir: boolean }) {
  const { t } = useTranslation("terminal");
  const { openIn } = useTerminalActions();
  return <ContextMenuItem onSelect={() => openIn(path, isDir)}>{t("openIn")}</ContextMenuItem>;
}
