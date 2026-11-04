// Clés typées : une clé inconnue est une erreur de `pnpm typecheck` (décision 0019).
import "i18next";
import type { en } from "./locales/en";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof en;
    returnNull: false;
    strictKeyChecks: true;
  }
}
