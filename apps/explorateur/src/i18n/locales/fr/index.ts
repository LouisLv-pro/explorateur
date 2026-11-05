// Catalogue français : même forme que l'anglais (`typeof en`), vérifiée par `pnpm typecheck`.
import type { en } from "../en";
import { app } from "./app";
import { browser } from "./browser";
import { common } from "./common";
import { defaultApp } from "./defaultApp";
import { editor } from "./editor";
import { errors } from "./errors";
import { files } from "./files";
import { git } from "./git";
import { issues } from "./issues";
import { notebook } from "./notebook";
import { preview } from "./preview";
import { search } from "./search";
import { servers } from "./servers";
import { shortcuts } from "./shortcuts";
import { terminal } from "./terminal";
import { tree } from "./tree";

export const fr: typeof en = {
  app,
  browser,
  common,
  defaultApp,
  editor,
  errors,
  files,
  git,
  issues,
  notebook,
  preview,
  search,
  servers,
  shortcuts,
  terminal,
  tree,
};
