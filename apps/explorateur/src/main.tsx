import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyInitialTheme } from "@/lib/theme";
import App from "./App";
import { commands } from "./bindings";
import { THEME_KEY } from "./features/theme/theme";
import { applyInitialZoom } from "./features/zoom/appZoom";
import { applyInitialLanguage, onLanguageApplied } from "./i18n";
import "./index.css";

// Thème posé avant tout `await` et avant le premier rendu : pas de flash clair en sombre.
// (La CSP interdit un script inline dans index.html.) La fenêtre, créée masquée, est affichée
// ensuite ; Rust l'affiche seul après 2 s en secours (`show_window_fallback`).
applyInitialTheme(THEME_KEY);

// Dans un navigateur (pnpm dev, playwright-cli), les commandes Rust sont simulées.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMockIpc } = await import("./dev/mock-ipc");
  installMockIpc();
}

// Zoom enregistré (spec zoom.md), posé sur la webview avant le premier rendu : la fenêtre est
// encore masquée, elle s'affiche déjà à la bonne taille. Après l'IPC simulée, qui répond aussi.
await applyInitialZoom();

// Langue de l'interface (spec langue-interface.md), avant le premier rendu. Le menu natif
// suit : Rust le rebâtit dans la langue appliquée. Après l'IPC simulée, qui répond aussi.
onLanguageApplied((lang) => {
  void commands.setLanguage(lang);
});
applyInitialLanguage();

const queryClient = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("élément #root introuvable dans index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
