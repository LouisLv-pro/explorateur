import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Message } from "./Message";
import "./preview.css";

/**
 * Image par le protocole `asset` (`src` fait par `convertFileSrc`), centrée sur un damier.
 * Réduite pour tenir dans la zone (jamais agrandie) ; un clic bascule entre « ajusté » et
 * « taille réelle ». À monter avec `key={path}` : l'état est propre à chaque image.
 */
export function ImageView({
  src,
  version,
  name,
  onSize,
}: {
  src: string;
  /** Version de l'image sur le disque : une nouvelle version retente une image illisible. */
  version: number;
  name: string;
  onSize: (width: number, height: number) => void;
}) {
  const { t } = useTranslation("preview");
  const [actual, setActual] = useState(false);
  const [failedVersion, setFailedVersion] = useState<number | null>(null);

  if (failedVersion === version) return <Message>{t("image.unreadable")}</Message>;
  return (
    <div className="checker flex min-h-0 min-w-0 flex-1 overflow-auto">
      <img
        src={src}
        alt={name}
        onClick={() => setActual((v) => !v)}
        onError={() => setFailedVersion(version)}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0) onSize(naturalWidth, naturalHeight);
        }}
        className={cn(
          "m-auto",
          actual
            ? "max-w-none cursor-zoom-out"
            : "max-h-full max-w-full cursor-zoom-in object-contain",
        )}
      />
    </div>
  );
}
