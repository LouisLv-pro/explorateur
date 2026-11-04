// Lignes d'un diff, unifié ou scindé : numéros, signe, code coloré et mots surlignés.
import { useTranslation } from "react-i18next";
import type { DiffLine } from "@/bindings";
import type { Token } from "@/features/preview/highlight";
import { cn } from "@/lib/utils";
import { markChanges, splitRows, type ColoredToken } from "./model";
import type { DiffMode } from "./width";

// Bits de `fontStyle` d'un jeton Shiki.
const ITALIC = 1;
const BOLD = 2;

/** Jetons colorés d'une ligne, `null` tant que la coloration n'est pas prête. */
export type LineTokens = (line: DiffLine, index: number) => Token[] | null;

const ROW_BG: Record<DiffLine["kind"], string> = {
  context: "",
  added: "bg-diff-added",
  removed: "bg-diff-removed",
};
const STRONG_BG: Record<DiffLine["kind"], string> = {
  context: "",
  added: "bg-diff-added-strong",
  removed: "bg-diff-removed-strong",
};
const SIGN: Record<DiffLine["kind"], string> = { context: " ", added: "+", removed: "−" };
const SIGN_COLOR: Record<DiffLine["kind"], string> = {
  context: "text-mute",
  added: "text-vcs-added",
  removed: "text-vcs-deleted",
};

/** Code d'une ligne : jetons Shiki (sinon texte brut) coupés aux mots changés. */
function Code({ line, tokens }: { line: DiffLine; tokens: Token[] | null }) {
  const base: ColoredToken[] =
    tokens && tokens.map((t) => t.content).join("") === line.text
      ? tokens
      : [{ content: line.text }];
  const segments = markChanges(base, line.changes);
  return (
    <>
      {segments.map((segment, i) => (
        <span
          key={i}
          className={cn(segment.changed && cn("rounded-xs", STRONG_BG[line.kind]))}
          style={{
            color: segment.color,
            fontStyle: (segment.fontStyle ?? 0) & ITALIC ? "italic" : undefined,
            fontWeight: (segment.fontStyle ?? 0) & BOLD ? 600 : undefined,
          }}
        >
          {segment.content}
        </span>
      ))}
      {/* Comme `\ No newline at end of file` de git diff. */}
      {line.noNewline && <NoNewline />}
    </>
  );
}

/** Composant à part : seules les rares lignes sans fin de ligne s'abonnent à la langue. */
function NoNewline() {
  const { t } = useTranslation("git");
  return (
    <span className="ml-3 font-sans text-caption text-mute italic select-none">
      {t("diff.noNewline")}
    </span>
  );
}

function LineNumber({ value }: { value: number | null }) {
  return <span className="w-10 shrink-0 pr-2 text-right text-mute select-none">{value ?? ""}</span>;
}

/** Lignes d'un bloc (ou de contexte déplié) dans le mode choisi. */
export function DiffLines({
  lines,
  mode,
  tokensOf,
}: {
  lines: readonly DiffLine[];
  mode: DiffMode;
  tokensOf: LineTokens;
}) {
  // Rang de chaque ligne dans `lines`, pour retrouver ses jetons depuis le mode Scindé.
  const indexOf = new Map(lines.map((line, i) => [line, i]));

  if (mode === "split") {
    return splitRows(lines).map((row, i) => (
      <div key={i} className="grid grid-cols-2">
        {[row.left, row.right].map((line, side) => (
          <div
            key={side}
            className={cn(
              "flex min-w-0",
              side === 1 && "border-l border-hairline",
              line ? ROW_BG[line.kind] : "bg-canvas-soft",
            )}
          >
            {line && (
              <>
                <LineNumber value={side === 0 ? line.oldNumber : line.newNumber} />
                <span className={cn("w-4 shrink-0 select-none", SIGN_COLOR[line.kind])}>
                  {SIGN[line.kind]}
                </span>
                <span className="min-w-0 flex-1 pr-2 whitespace-pre-wrap wrap-anywhere">
                  <Code line={line} tokens={tokensOf(line, indexOf.get(line) ?? 0)} />
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    ));
  }

  return lines.map((line, i) => (
    <div key={i} className={cn("flex", ROW_BG[line.kind])}>
      <LineNumber value={line.oldNumber} />
      <LineNumber value={line.newNumber} />
      <span className={cn("w-4 shrink-0 select-none", SIGN_COLOR[line.kind])}>
        {SIGN[line.kind]}
      </span>
      <span className="min-w-0 flex-1 pr-2 whitespace-pre-wrap wrap-anywhere">
        <Code line={line} tokens={tokensOf(line, i)} />
      </span>
    </div>
  ));
}
