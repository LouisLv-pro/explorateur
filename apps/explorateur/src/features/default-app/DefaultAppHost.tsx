import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useCommand } from "@/features/commands/store";
import { DefaultAppDialog } from "./DefaultAppDialog";

/**
 * Ouvre le dialogue « app par défaut » : par l'entrée du menu natif (événement
 * `default-app-requested`, comme `quit-requested`) ou par la commande `default-app` de la palette.
 */
export function DefaultAppHost() {
  const { t } = useTranslation(["defaultApp", "shortcuts"]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unlisten = listen("default-app-requested", () => setOpen(true));
    return () => void unlisten.then((stop) => stop());
  }, []);

  useCommand({
    id: "default-app",
    label: t("defaultApp:command"),
    group: t("shortcuts:groups.general"),
    run: () => setOpen(true),
  });

  return <DefaultAppDialog open={open} onOpenChange={setOpen} />;
}
