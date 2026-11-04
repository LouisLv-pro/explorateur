// Diagramme Mermaid dessiné par Pele (docs/specs/diagrammes-mermaid.md, décision workspace 0007).
// Sert aux blocs ```mermaid du Markdown, aux issues et aux fichiers `.mmd`. Le SVG est inséré
// par Pele (pas de script, de HTML ni de clic) : jamais de `dangerouslySetInnerHTML`.
// Les couleurs viennent du CSS (`.pele` dans index.css) : un changement de thème recolore le
// SVG déjà affiché, sans nouveau rendu.
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { detectType, load, mountAsync, type Mounted, type MountOptions } from "pele/lazy";

/** Charge le type de diagramme de `source` ; une source illisible ou inconnue ne lève pas. */
async function loadType(source: string): Promise<void> {
  try {
    await load(detectType(source));
  } catch {
    // `update` affichera l'erreur de Pele.
  }
}

/** Options identiques partout : l'utilisateur n'en passe aucune. Lues au montage (langue active). */
function options(): MountOptions {
  return {
    // Ni lien ni image distante : le texte d'une issue vient de tiers.
    links: false,
    images: false,
    // Un `flowchart LR` reste horizontal dans un panneau étroit : le zoom prend le relais.
    autoDirection: false,
    // Mode `auto` : actif seulement quand le diagramme a rétréci.
    zoom: {
      labels: {
        zoomIn: i18n.t("preview:mermaid.zoomIn"),
        zoomOut: i18n.t("preview:mermaid.zoomOut"),
        reset: i18n.t("preview:mermaid.reset"),
      },
    },
  };
}

type Props = {
  source: string;
  /** Marges et mise en page propres à la surface (colonne Markdown, aperçu d'un `.mmd`). */
  className?: string;
};

export function MermaidDiagram({ source, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<Mounted | null>(null);
  const sourceRef = useRef(source);
  const { i18n: instance } = useTranslation();
  const language = instance.resolvedLanguage;
  const idPrefix = `diagram-${useId().replace(/\W/g, "")}`;

  // Un seul montage : Pele suit la largeur du conteneur et garde son zoom. Chaque montage a son
  // élément, créé ici : le double montage de StrictMode ne fait pas se marcher dessus.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const element = document.createElement("div");
    element.className = "mermaid-diagram";
    host.append(element);
    let cancelled = false;
    mountAsync(element, sourceRef.current, { ...options(), idPrefix })
      .then((mounted) => {
        if (cancelled) {
          mounted.destroy();
          return;
        }
        mountedRef.current = mounted;
        // La source a changé pendant le chargement du type de diagramme.
        const latest = sourceRef.current;
        if (mounted.source !== latest) {
          void loadType(latest).then(() => {
            if (mountedRef.current === mounted && sourceRef.current === latest) {
              mounted.update(latest);
            }
          });
        }
      })
      .catch(() => {
        if (!cancelled) element.textContent = i18n.t("preview:mermaid.unavailable");
      });
    return () => {
      cancelled = true;
      mountedRef.current?.destroy();
      mountedRef.current = null;
      element.remove();
    };
    // Les libellés du zoom se donnent au montage : un changement de langue remonte le diagramme.
  }, [idPrefix, language]);

  // Source changée (frappe, disque) : `update`, sans remonter. Une erreur passagère garde le
  // dernier diagramme, grisé.
  useEffect(() => {
    sourceRef.current = source;
    const mounted = mountedRef.current;
    if (!mounted || mounted.source === source) return;
    // Pele ne charge que le type de la source montée : un autre type (flowchart devenu pie)
    // se charge d'abord, sinon `update` répondrait « type non géré ».
    void loadType(source).then(() => {
      if (mountedRef.current === mounted && sourceRef.current === source) mounted.update(source);
    });
  }, [source]);

  return <div ref={hostRef} className={className} />;
}
