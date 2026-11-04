import { useTranslation } from "react-i18next";
import { useReadDot } from "./api";

/** Point bleu d'une entrée de l'arborescence modifiée depuis la dernière lecture. */
export function ReadDot({
  rootPath,
  path,
  isDir,
  open,
}: {
  rootPath: string | undefined;
  path: string;
  isDir: boolean;
  open: boolean;
}) {
  const { t } = useTranslation("files");
  const dot = useReadDot(rootPath, path, isDir, open);
  if (dot === null) return null;
  const title = dot === "dir" ? t("lastRead.dirChanged") : t("lastRead.changed");
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className="size-1.5 shrink-0 rounded-full bg-link"
    />
  );
}
