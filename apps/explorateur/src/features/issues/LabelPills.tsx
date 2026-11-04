import { useTranslation } from "react-i18next";
import type { Label } from "@/bindings";
import { labelBackground, labelTextColor } from "./model";

/**
 * Un label en pastille : fond de la couleur GitHub (donnée du dépôt, pas un rôle du thème),
 * texte noir ou blanc selon le contraste. La description est l'infobulle.
 */
export function LabelPill({ label }: { label: Label }) {
  return (
    <span
      title={label.description === "" ? label.name : label.description}
      style={{
        backgroundColor: labelBackground(label.color),
        color: labelTextColor(label.color),
      }}
      className="inline-block max-w-full truncate rounded-full px-2 align-middle text-caption"
    >
      {label.name}
    </span>
  );
}

/** Labels en pastilles, côte à côte. */
export function LabelPills({ labels }: { labels: readonly Label[] }) {
  const { t } = useTranslation("issues");
  if (labels.length === 0) return null;
  return (
    <ul aria-label={t("labels.list")} className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <li key={label.name} className="max-w-full">
          <LabelPill label={label} />
        </li>
      ))}
    </ul>
  );
}
