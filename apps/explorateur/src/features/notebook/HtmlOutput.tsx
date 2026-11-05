import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { classifyLink } from "@/features/preview/markdown/links";
import {
  OUTPUT_HTML_REHYPE_PLUGINS,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
} from "@/features/preview/markdown/pipeline";

/**
 * Liens d'une cellule ou d'une sortie : une adresse web s'ouvre dans le navigateur, le reste ne
 * fait rien (un clic ne doit jamais faire naviguer la page de l'app). Stable : défini une fois.
 */
const COMPONENTS: Components = {
  a({ node: _node, href, children, ...rest }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
    return (
      <a
        {...rest}
        href={href}
        title={href}
        onClick={(event) => {
          event.preventDefault();
          if (href && classifyLink(href) === "external") void openUrl(href).catch(() => {});
        }}
      >
        {children}
      </a>
    );
  },
};

type MdastRoot = { children: unknown[] };

/** Plugin remark : tout le texte est un seul bloc HTML (le Markdown couperait aux lignes vides). */
function remarkWholeHtml() {
  return (tree: MdastRoot, file: { value: unknown }) => {
    tree.children = [{ type: "html", value: String(file.value) }];
  };
}

const HTML_REMARK_PLUGINS = [remarkWholeHtml];

/** Sortie `text/html` : nettoyée par le schéma du Markdown (décision 0004), sans script. */
export function HtmlOutput({ html }: { html: string }) {
  return (
    <div className="nb-html">
      <ReactMarkdown
        remarkPlugins={HTML_REMARK_PLUGINS}
        rehypePlugins={OUTPUT_HTML_REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {html}
      </ReactMarkdown>
    </div>
  );
}

/** Cellule Markdown ou sortie `text/markdown` : le pipeline Markdown de l'app. */
export function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="md nb-md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
