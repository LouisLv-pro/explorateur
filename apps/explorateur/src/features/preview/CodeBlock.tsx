import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ColorSwatch, withSwatches } from "@/features/colors/ColorSwatch";
import { findColors, type FoundColor } from "@/features/colors/findColors";
import { MAX_HIGHLIGHT_CHARS, useHighlighted, type Token } from "./highlight";

const COPIED_MS = 1500;

// Bits de `fontStyle` d'un jeton Shiki.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

/**
 * Contenu d'un jeton, avec une pastille devant chaque couleur qui y commence. `colors` : couleurs
 * de la ligne, `offset` : position du jeton dans la ligne (une couleur comme
 * `rgb(1 2 3)` s'étend sur plusieurs jetons, d'où la recherche sur la ligne entière).
 */
function tokenContent(content: string, offset: number, colors: FoundColor[]): ReactNode {
  const inside = colors.filter((c) => c.start >= offset && c.start < offset + content.length);
  if (inside.length === 0) return content;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const { start, value } of inside) {
    const at = start - offset;
    if (at > last) nodes.push(content.slice(last, at));
    nodes.push(<ColorSwatch key={at} color={value} />);
    last = at;
  }
  nodes.push(content.slice(last));
  return nodes;
}

function TokenLine({ line }: { line: Token[] }) {
  const colors = findColors(line.map((token) => token.content).join(""));
  let offset = 0;
  return line.map((token, j) => {
    const start = offset;
    offset += token.content.length;
    return (
      <span
        key={j}
        style={{
          color: token.color,
          fontStyle: (token.fontStyle ?? 0) & ITALIC ? "italic" : undefined,
          fontWeight: (token.fontStyle ?? 0) & BOLD ? 600 : undefined,
          textDecoration: (token.fontStyle ?? 0) & UNDERLINE ? "underline" : undefined,
        }}
      >
        {tokenContent(token.content, start, colors)}
      </span>
    );
  });
}

/** Jetons colorés, une ligne par ligne du code, séparées par `\n` (copie fidèle). */
function TokenLines({ tokens }: { tokens: Token[][] }) {
  // Une fin de ligne finale produit une ligne vide en trop.
  const lines = tokens.at(-1)?.length === 0 ? tokens.slice(0, -1) : tokens;
  return lines.map((line, i) => (
    <Fragment key={i}>
      <TokenLine line={line} />
      {i < lines.length - 1 ? "\n" : null}
    </Fragment>
  ));
}

/** Bloc de code d'un document Markdown : coloré, avec un bouton « Copier » au survol. */
export function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const { t } = useTranslation("preview");
  const tokens = useHighlighted(code, lang);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Presse-papiers refusé : pas de retour « Copié ».
    }
  }

  return (
    <div className="group relative my-4">
      <pre className="overflow-auto rounded-md border border-hairline bg-canvas-soft p-3 font-mono text-code text-ink">
        <code>
          {tokens ? (
            <TokenLines tokens={tokens} />
          ) : code.length <= MAX_HIGHLIGHT_CHARS ? (
            withSwatches(code)
          ) : (
            code
          )}
        </code>
      </pre>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => void copy()}
        aria-label={copied ? t("codeBlock.copied") : t("codeBlock.copyCode")}
        className="absolute top-2 right-2 bg-canvas text-mute opacity-0 group-hover:opacity-100 focus-visible:opacity-100 motion-safe:transition-opacity"
      >
        {copied ? <Check /> : <Copy />}
        {copied ? t("codeBlock.copied") : t("codeBlock.copy")}
      </Button>
    </div>
  );
}
