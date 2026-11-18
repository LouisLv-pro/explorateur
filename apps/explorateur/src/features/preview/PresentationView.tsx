import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PresentationRender } from "@/bindings";
import { previewUrl } from "@/lib/paths";
import { Message } from "./Message";

const PREPARING_DELAY_MS = 150;

/** « Préparation de l'aperçu… », montré seulement si le rendu dure (pas de clignotement). */
export function PresentationPending() {
  const { t } = useTranslation("preview");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), PREPARING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <Message>
      <p>{t("presentation.preparing")}</p>
    </Message>
  );
}

/** Présentation rendue : l'`iframe` lit le `Preview.html` du cache par le protocole `preview`. */
export function PresentationView({ render, name }: { render: PresentationRender; name: string }) {
  const { t } = useTranslation("preview");
  return (
    <iframe
      title={t("presentation.frameTitle", { name })}
      // Chemin vide : navigateur simulé (protocole `preview` absent), l'iframe reste vide
      // sans erreur de console.
      src={render.html ? previewUrl(convertFileSrc("", "preview"), render.html) : undefined}
      // Ni scripts ni même origine : le HTML vient d'un fichier que l'on n'a pas écrit.
      sandbox=""
      className="min-h-0 w-full min-w-0 flex-1 border-0 bg-canvas"
    />
  );
}
