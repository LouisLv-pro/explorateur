import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { Entry } from "@/bindings";
import i18n from "@/i18n";
import { relativePath } from "@/lib/paths";
import { useWorkspaceActions } from "@/features/workspace/context";
import { filePreviewQuery } from "../api";
import { CodeBlock } from "../CodeBlock";
import { MermaidDiagram } from "../mermaid/MermaidDiagram";
import { classifyLink, headingId, isInside, resolveRelative } from "./links";
import { useLinkRepo } from "@/features/issues/api";
import { useIssueOpener } from "@/features/issues/open";
import { hasIssueRef, sameRepoIssueNumber } from "@/features/issues/refs";
import { REHYPE_PLUGINS, REHYPE_PLUGINS_WITH_ISSUES, REMARK_PLUGINS } from "./pipeline";
import { Outline } from "./OutlinePanel";
import { activeHeading, isAtBottom, useOutlineShown, type OutlineItem } from "./outline";
import "./markdown.css";

const NOTICE_MS = 3000;
/** Préfixe posé par `rehype-sanitize` sur les `id` et `name` du HTML brut. */
const CLOBBER_PREFIX = "user-content-";

/** Ancre à suivre après l'ouverture d'un autre fichier par un lien `fichier.md#ancre`. */
let pendingAnchor = "";

/** Texte brut d'un contenu React (pour l'identifiant d'un titre). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Cible d'une ancre : `id` puis `name`, tels quels puis préfixés par le nettoyage. */
function anchorTarget(container: HTMLElement, hash: string): Element | undefined {
  const candidates = Array.from(container.querySelectorAll("[id], [name]"));
  for (const name of [hash, CLOBBER_PREFIX + hash]) {
    const target =
      candidates.find((el) => el.id === name) ??
      candidates.find((el) => el.getAttribute("name") === name);
    if (target) return target;
  }
  return undefined;
}

/** Défile le seul conteneur de l'aperçu : `scrollIntoView` ferait aussi défiler la fenêtre. */
function scrollToElement(container: HTMLElement, target: Element) {
  const scroller = container.parentElement;
  if (!scroller) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top =
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
}

function scrollToAnchor(container: HTMLElement | null, hash: string) {
  if (!container || !hash) return;
  const target = anchorTarget(container, hash);
  if (target) scrollToElement(container, target);
}

/** Marge sous le haut de la zone visible : un titre qui l'a passée est le titre lu. */
const ACTIVE_OFFSET = 24;

/** Titres `h1` à `h3` du document rendu (HTML brut compris), sans ceux qui n'ont pas de texte. */
function readHeadings(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3")).filter(
    (el) => (el.textContent ?? "").trim() !== "",
  );
}

function sameItems(a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean {
  return (
    a.length === b.length && a.every((x, i) => x.level === b[i]!.level && x.text === b[i]!.text)
  );
}

function heading(Tag: ElementType): Components["h1"] {
  return function Heading({ node: _node, id, children, ...props }) {
    return (
      <Tag id={id ?? headingId(textOf(children))} {...props}>
        {children}
      </Tag>
    );
  };
}

/** Image d'un document : source relative par le protocole `asset`, sinon telle quelle. */
function MarkdownImage({
  src,
  alt,
  from,
  width,
  height,
}: {
  src: string;
  alt: string;
  from: string;
  width?: number | string;
  height?: number | string;
}) {
  const [failed, setFailed] = useState(false);
  const url = /^https?:\/\//i.test(src)
    ? src
    : (() => {
        const resolved = resolveRelative(from, src);
        return resolved ? convertFileSrc(resolved.path) : null;
      })();
  if (failed || !url) return <span className="text-mute">{alt}</span>;
  return <img src={url} alt={alt} width={width} height={height} onError={() => setFailed(true)} />;
}

type Props = {
  text: string;
  /** Chemin absolu du fichier Markdown. */
  path: string;
  rootPath: string;
};

/** Document Markdown rendu (GFM). Chargé à la demande : react-markdown pèse lourd. */
export default function MarkdownView({ text, path, rootPath }: Props) {
  const { openFile } = useWorkspaceActions();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("preview");
  // Les données du message, traduites au rendu : le changement de langue le met à jour.
  const [notice, setNotice] = useState<{
    kind: "openFailed" | "linkNotFound";
    target: string;
  } | null>(null);
  // Sommaire (spec sommaire-markdown.md) : les titres se lisent dans le DOM rendu, ce qui laisse
  // les `components` de react-markdown inchangés.
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [active, setActive] = useState(-1);
  const outlineWanted = useOutlineShown();
  const showOutline = outlineWanted && items.length >= 2;
  // `openFile` est stable, mais passe par une ref comme les issues : les `components` restent
  // les mêmes et React ne remonte pas les images déjà affichées.
  const openFileRef = useRef(openFile);
  // Références d'issue (spec issues-github.md, lot 3) : `#123` et liens `…/issues/123` du dépôt
  // GitHub du dossier racine. Le dépôt n'est demandé à `gh` que si le texte en contient.
  const { openIssue } = useIssueOpener();
  const wantsIssues = useMemo(() => hasIssueRef(text) || text.includes("github.com/"), [text]);
  const repoName = useLinkRepo(rootPath, wantsIssues)?.nameWithOwner ?? null;
  const issuesRef = useRef({ repoName, open: (_number: number) => {} });
  useEffect(() => {
    openFileRef.current = openFile;
    issuesRef.current = { repoName, open: (number) => void openIssue(rootPath, number) };
  });

  // Arrivée par un lien `fichier.md#ancre` : on suit l'ancre une fois le document affiché.
  useEffect(() => {
    scrollToAnchor(containerRef.current, pendingAnchor);
    pendingAnchor = "";
  }, [text]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const components = useMemo((): Components => {
    async function follow(href: string) {
      const issue = sameRepoIssueNumber(href, issuesRef.current.repoName);
      if (issue !== null) {
        issuesRef.current.open(issue);
        return;
      }
      const kind = classifyLink(href);
      if (kind === "external") {
        await openUrl(href).catch(() => setNotice({ kind: "openFailed", target: href }));
      } else if (kind === "anchor") {
        scrollToAnchor(containerRef.current, decodeURIComponentSafe(href.slice(1)));
      } else if (kind === "file") {
        const resolved = resolveRelative(path, href);
        if (!resolved || !isInside(resolved.path, rootPath)) {
          setNotice({ kind: "linkNotFound", target: href });
          return;
        }
        if (resolved.path === path) {
          scrollToAnchor(containerRef.current, resolved.hash);
          return;
        }
        try {
          // Amorce le cache : l'aperçu du fichier cible s'affiche sans attente.
          const target = await queryClient.fetchQuery(filePreviewQuery(resolved.path));
          pendingAnchor = resolved.hash;
          openFileRef.current(entryOf(target.path, target.name, target.content.kind));
        } catch {
          setNotice({ kind: "linkNotFound", target: relativePath(resolved.path, rootPath) });
        }
      }
    }

    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      // Liens Markdown et `<a>` du HTML brut (spec html-brut-markdown.md). Les autres
      // attributs gardés par le nettoyage (`id`, `name`, classes des notes) passent tels quels.
      a({
        node: _node,
        href,
        children,
        ...rest
      }: ComponentPropsWithoutRef<"a"> & { node?: unknown; "data-issue-ref"?: string }) {
        const issueRef = rest["data-issue-ref"];
        return (
          <a
            {...rest}
            href={href}
            title={
              issueRef === undefined
                ? href
                : i18n.t("preview:markdown.openIssue", { number: issueRef })
            }
            onClick={(event) => {
              event.preventDefault();
              if (issueRef !== undefined) issuesRef.current.open(Number(issueRef));
              else if (href) void follow(href);
            }}
          >
            {children}
          </a>
        );
      },
      // Images Markdown et `<img>` du HTML brut : même résolution, `width` et `height` gardés.
      img({ node: _node, src, alt, width, height }) {
        if (typeof src !== "string") return null;
        return (
          <MarkdownImage
            key={src}
            src={src}
            alt={alt ?? ""}
            from={path}
            width={width}
            height={height}
          />
        );
      },
      pre({ node: _node, children }) {
        const code = Children.toArray(children).find((child) =>
          isValidElement<{ className?: string; children?: ReactNode }>(child),
        );
        if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) {
          return <pre>{children}</pre>;
        }
        const lang = /language-([\w+#-]+)/.exec(code.props.className ?? "")?.[1] ?? null;
        const text = textOf(code.props.children).replace(/\n$/, "");
        // ```mermaid (casse ignorée) : diagramme dessiné par Pele, hors de `rehype-sanitize`.
        if (lang?.toLowerCase() === "mermaid")
          return <MermaidDiagram source={text} className="my-4" />;
        return <CodeBlock code={text} lang={lang} />;
      },
    };
  }, [path, rootPath, queryClient]);

  // Liste des titres : relue après chaque rendu du document (texte, plugins ou composants).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = readHeadings(container).map((el) => ({
      level: Number(el.tagName[1]) as OutlineItem["level"],
      text: (el.textContent ?? "").trim(),
    }));
    setItems((previous) => (sameItems(previous, next) ? previous : next));
  }, [text, repoName, components]);

  // Titre lu : suit le défilement du document, et la liste quand elle change.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const container = containerRef.current;
    if (!scroller || !container || !showOutline) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const base = scroller.getBoundingClientRect().top;
      const tops = readHeadings(container).map((el) =>
        el.getClientRects().length === 0 ? null : el.getBoundingClientRect().top - base,
      );
      const { scrollTop, clientHeight, scrollHeight } = scroller;
      setActive(
        activeHeading(tops, ACTIVE_OFFSET, isAtBottom(scrollTop, clientHeight, scrollHeight)),
      );
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items, showOutline]);

  function selectHeading(rank: number) {
    const container = containerRef.current;
    const target = container && readHeadings(container)[rank];
    if (container && target) scrollToElement(container, target);
  }

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1">
      <div ref={scrollerRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div ref={containerRef} className="md">
          <Markdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={repoName === null ? REHYPE_PLUGINS : REHYPE_PLUGINS_WITH_ISSUES}
            components={components}
          >
            {text}
          </Markdown>
          {notice && (
            <p
              role="status"
              className="sticky bottom-4 mx-auto w-fit rounded-md bg-ink px-3 py-2 text-body-sm text-on-primary shadow-level-3"
            >
              {t(`markdown.${notice.kind}`, { target: notice.target })}
            </p>
          )}
        </div>
      </div>
      {showOutline && <Outline items={items} active={active} onSelect={selectHeading} />}
    </div>
  );
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Entrée de l'arborescence pour un fichier ouvert par un lien. */
function entryOf(path: string, name: string, kind: string): Entry {
  const previewKind =
    kind === "Markdown"
      ? "markdown"
      : kind === "Html"
        ? "html"
        : kind === "Mermaid"
          ? "mermaid"
          : kind === "Image"
            ? "image"
            : kind === "Pdf"
              ? "pdf"
              : "text";
  return { name, path, is_dir: false, preview_kind: previewKind };
}
