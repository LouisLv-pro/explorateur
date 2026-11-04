// Corps et commentaires d'une issue : même chaîne de rendu que l'aperçu Markdown (GFM, HTML brut
// nettoyé, pastilles de couleur, blocs de code colorés). Chargé à la demande comme MarkdownView.
// Liens ouverts dans le navigateur ; images distantes jamais chargées (CSP inchangée, décision
// 0010) : un lien « Image : <texte alternatif> » à la place.
import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/features/preview/CodeBlock";
import { MermaidDiagram } from "@/features/preview/mermaid/MermaidDiagram";
import {
  REHYPE_PLUGINS,
  REHYPE_PLUGINS_WITH_ISSUES,
  REMARK_PLUGINS,
} from "@/features/preview/markdown/pipeline";
import "@/features/preview/markdown/markdown.css";
import { isOpenable } from "./model";
import { sameRepoIssueNumber } from "./refs";
import { useIssueRefs } from "./refsContext";
import "./issue.css";

/** Texte brut d'un contenu React (code d'un bloc). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function open(href: string) {
  void openUrl(href).catch(() => {});
}

/**
 * Image du Markdown : jamais chargée. Un `span` plutôt qu'un lien, car l'image peut elle-même
 * se trouver dans un lien (badge) et un lien dans un lien n'est pas valide.
 */
function RemoteImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation("issues");
  const label = t("markdown.image", { alt: alt === "" ? t("markdown.imageNoAlt") : alt });
  if (!isOpenable(src)) return <span className="text-mute">{label}</span>;
  return (
    <span
      role="link"
      tabIndex={0}
      title={src}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(src);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        open(src);
      }}
      className="cursor-pointer text-link underline underline-offset-2"
    >
      {label}
    </span>
  );
}

/**
 * Lien du Markdown. Avec des références actives (issue en onglet) : `#123` (`data-issue-ref`) et
 * les liens `…/issues/123` du même dépôt ouvrent l'issue en onglet, les autres le navigateur.
 */
function Anchor({
  node: _node,
  href,
  children,
  ...rest
}: ComponentPropsWithoutRef<"a"> & { node?: unknown; "data-issue-ref"?: string }) {
  const { t } = useTranslation("issues");
  const refs = useIssueRefs();
  const ref = rest["data-issue-ref"];
  const number =
    ref !== undefined ? Number(ref) : sameRepoIssueNumber(href, refs?.repoName ?? null);
  const inApp = refs !== null && number !== null;
  return (
    <a
      {...rest}
      href={ref !== undefined ? undefined : href}
      title={ref !== undefined ? t("markdown.openIssue", { number: ref }) : href}
      role={ref !== undefined ? "link" : undefined}
      tabIndex={ref !== undefined ? 0 : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (inApp) refs.open(number);
        else if (isOpenable(href)) open(href);
      }}
      onKeyDown={
        ref !== undefined
          ? (event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (inApp) refs.open(number);
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

// Composants stables (module) : react-markdown ne remonte pas les nœuds à chaque rendu.
const COMPONENTS: Components = {
  a: Anchor,
  img({ node: _node, src, alt }) {
    return typeof src === "string" ? <RemoteImage src={src} alt={alt ?? ""} /> : null;
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
    // ```mermaid : diagramme de Pele, sans lien ni image (le texte d'une issue vient de tiers).
    if (lang?.toLowerCase() === "mermaid") return <MermaidDiagram source={text} className="my-4" />;
    return <CodeBlock code={text} lang={lang} />;
  },
};

export default function IssueMarkdown({ text }: { text: string }) {
  // `#123` n'est lié que dans une issue en onglet (dépôt connu) : pas dans l'aperçu du dialogue.
  const linked = useIssueRefs() !== null;
  return (
    <div className="md issue-md">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={linked ? REHYPE_PLUGINS_WITH_ISSUES : REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
}
