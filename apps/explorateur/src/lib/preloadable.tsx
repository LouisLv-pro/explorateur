import { lazy, useState, type ComponentType } from "react";

/**
 * `lazy` qu'on peut charger à l'avance (`preload`). Une fois chargé, le composant s'affiche
 * sans passer par `Suspense` : `lazy` suspend même sur un module déjà là, et la page peint
 * alors une image vide. Le choix est fixé au montage : un volet déjà affiché n'est jamais
 * remonté (son état et son défilement restent).
 */
export function preloadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const remember = (module: { default: ComponentType<P> }) => {
    loaded = module.default;
    return module;
  };
  const Lazy = lazy(() => load().then(remember));

  function Preloadable(props: P) {
    const [Loaded] = useState(() => loaded);
    return Loaded ? <Loaded {...props} /> : <Lazy {...props} />;
  }

  function preload(): Promise<void> {
    pending ??= load().then(
      (module) => void remember(module),
      () => {
        // Échec (réseau du serveur de dev) : le prochain affichage réessaiera.
        pending = null;
      },
    );
    return pending;
  }

  return { Component: Preloadable, preload };
}
