import { CircleCheck, CircleDot, CircleSlash } from "lucide-react";
import type { IssueState } from "@/bindings";
import { cn } from "@/lib/utils";

/** Icône d'état d'une issue : ouverte (vert), fermée (violet), fermée non prévue (violet barré). */
export function IssueIcon({
  state,
  reason,
  className,
}: {
  state: IssueState;
  reason?: string | null;
  className?: string;
}) {
  const Icon = state === "OPEN" ? CircleDot : reason === "NOT_PLANNED" ? CircleSlash : CircleCheck;
  return (
    <Icon
      aria-hidden
      className={cn(state === "OPEN" ? "text-issue-open" : "text-issue-closed", className)}
    />
  );
}
