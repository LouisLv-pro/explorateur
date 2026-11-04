// Diff depuis la dernière lecture : unifié, mêmes lignes que le volet Modifications, contexte
// masqué indiqué sans dépliage.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffContent } from "@/bindings";
import { DiffLines, type LineTokens } from "@/features/git/DiffLines";
import { hunkStarts, sideTexts } from "@/features/git/model";
import { useHighlighted } from "@/features/preview/highlight";
import { languageFor } from "@/features/preview/languages";

type TextContent = Extract<DiffContent, { kind: "text" }>;

export function ReadDiff({ diff, name }: { diff: DiffContent; name: string }) {
  const { t } = useTranslation("files");
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {diff.kind === "text" ? (
        <TextDiff content={diff} name={name} />
      ) : (
        <p className="px-4 py-3 text-body-sm text-mute">{t("lastRead.diffUnavailable")}</p>
      )}
    </div>
  );
}

function TextDiff({ content, name }: { content: TextContent; name: string }) {
  const { t } = useTranslation("files");
  const [revealed, setRevealed] = useState(false);
  const shown = !content.tooLong || revealed;
  const lang = shown ? languageFor(name) : null;
  const all = useMemo(() => content.hunks.flatMap((hunk) => hunk.lines), [content]);
  const sides = useMemo(() => sideTexts(all), [all]);
  const starts = useMemo(() => hunkStarts(content.hunks), [content]);
  const oldTokens = useHighlighted(sides.old, lang);
  const newTokens = useHighlighted(sides.new, lang);

  if (!shown) {
    return (
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-sm px-2 py-1 text-body-sm text-link hover:bg-canvas-soft-2"
        >
          {t("lastRead.showDiff", { count: content.lineCount })}
        </button>
      </div>
    );
  }

  return (
    <div className="font-mono text-code text-ink">
      {content.hunks.map((hunk, i) => {
        const start = starts[i] ?? 0;
        const tokensOf: LineTokens = (_line, index) => {
          const at = sides.index[start + index];
          if (!at) return null;
          const tokens = at.side === "old" ? oldTokens : newTokens;
          return tokens?.[at.row] ?? null;
        };
        return [
          <Gap key={`gap-${i}`} count={hunk.hiddenBefore} />,
          <DiffLines key={`hunk-${i}`} lines={hunk.lines} mode="unified" tokensOf={tokensOf} />,
        ];
      })}
      <Gap count={content.hiddenAfter} />
    </div>
  );
}

/** Lignes masquées entre deux blocs : indiquées, sans dépliage. */
function Gap({ count }: { count: number }) {
  const { t } = useTranslation("files");
  if (count === 0) return null;
  return (
    <div className="flex h-6 items-center bg-canvas-soft px-3 font-sans text-caption text-mute select-none">
      ⋯ {t("lastRead.hidden", { count })}
    </div>
  );
}
