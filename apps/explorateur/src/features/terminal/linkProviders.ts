// Fournisseurs de liens d'une page du terminal (docs/specs/terminal.md, lot 2) : URL `http(s)`
// et chemins de fichier (Rust, `find_terminal_links`). Seul ⌘clic ouvre ; le soulignement et le
// curseur main n'apparaissent qu'avec ⌘ enfoncé.
import type { IDisposable, ILink, Terminal } from "@xterm/xterm";
import { findIssueRefs } from "@/features/issues/refs";
import { lineText, findUrls, type Cell, type LineText } from "./links";
import { findFileLinks } from "./api";

export type LinkHandlers = {
  /** Dossier de départ de la page et dossier racine courant (`null` : pas de liens fichier). */
  context: () => { cwd: string; root: string | null };
  openUrl: (url: string) => void;
  openFile: (path: string, line: number | null) => void;
  /** `#123` (issue 123 du dépôt GitHub du dossier racine, spec issues-github.md, lot 3). */
  openIssue: (number: number) => void;
};

/** Texte de la ligne `y` (1-indexée) du tampon affiché. */
function readLine(term: Terminal, y: number): LineText | null {
  const buffer = term.buffer.active;
  const line = buffer.getLine(y - 1);
  if (!line) return null;
  const cell = buffer.getNullCell();
  const cells: Cell[] = [];
  for (let x = 0; x < line.length; x += 1) {
    line.getCell(x, cell);
    cells.push({ chars: cell.getChars(), width: cell.getWidth() });
  }
  return lineText(cells);
}

/** Enregistre les trois fournisseurs ; `dispose` les retire avec l'écoute de ⌘. */
export function registerLinkProviders(term: Terminal, handlers: LinkHandlers): IDisposable {
  /** Lien sous la souris : ses décorations suivent l'état de ⌘. */
  let hovered: ILink | null = null;

  const decorate = (link: ILink, meta: boolean) => {
    if (!link.decorations) return;
    link.decorations.underline = meta;
    link.decorations.pointerCursor = meta;
  };

  const makeLink = (
    y: number,
    line: LineText,
    start: number,
    end: number,
    open: () => void,
  ): ILink | null => {
    const columns = line.columns(start, end);
    if (columns === null) return null;
    const link: ILink = {
      range: { start: { x: columns.start, y }, end: { x: columns.end, y } },
      text: line.text.slice(start, end),
      decorations: { underline: false, pointerCursor: false },
      activate: (event) => {
        if (event.metaKey) open();
      },
      hover: (event) => {
        hovered = link;
        decorate(link, event.metaKey);
      },
      leave: () => {
        if (hovered === link) hovered = null;
        decorate(link, false);
      },
    };
    return link;
  };

  const urls = term.registerLinkProvider({
    provideLinks: (y, callback) => {
      const line = readLine(term, y);
      if (!line) return callback(undefined);
      const links = findUrls(line.text)
        .map((m) => makeLink(y, line, m.start, m.end, () => handlers.openUrl(m.url)))
        .filter((l) => l !== null);
      callback(links.length > 0 ? links : undefined);
    },
  });

  const files = term.registerLinkProvider({
    provideLinks: (y, callback) => {
      const { cwd, root } = handlers.context();
      const line = readLine(term, y);
      if (root === null || !line || line.text.trim() === "") return callback(undefined);
      void findFileLinks(line.text, cwd, root).then((found) => {
        const links = found
          .map((f) => makeLink(y, line, f.start, f.end, () => handlers.openFile(f.path, f.line)))
          .filter((l) => l !== null);
        callback(links.length > 0 ? links : undefined);
      });
    },
  });

  // `#123` : issue du dépôt GitHub du dossier racine. Le dépôt n'est lu qu'au clic (le message
  // d'erreur dit alors pourquoi rien ne s'ouvre) : repérer une référence ne lance pas `gh`.
  const issues = term.registerLinkProvider({
    provideLinks: (y, callback) => {
      const line = readLine(term, y);
      if (handlers.context().root === null || !line) return callback(undefined);
      const links = findIssueRefs(line.text)
        .map((r) => makeLink(y, line, r.start, r.end, () => handlers.openIssue(r.number)))
        .filter((l) => l !== null);
      callback(links.length > 0 ? links : undefined);
    },
  });

  // ⌘ enfoncé ou relâché pendant le survol : le soulignement apparaît ou disparaît.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Meta" && hovered) decorate(hovered, event.type === "keydown");
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  return {
    dispose: () => {
      urls.dispose();
      files.dispose();
      issues.dispose();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    },
  };
}
