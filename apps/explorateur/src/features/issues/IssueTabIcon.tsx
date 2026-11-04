import { useQuery } from "@tanstack/react-query";
import type { IssueState } from "@/bindings";
import { useWorkspace } from "@/features/workspace/context";
import { issueQuery } from "./api";
import { IssueIcon } from "./IssueIcon";

/**
 * Icône de l'onglet d'une issue : l'état lu par l'onglet s'il l'est (une issue fermée depuis
 * change l'icône), sinon l'état connu à l'ouverture. Ne lance aucune lecture (`enabled: false`).
 */
export function IssueTabIcon({
  number,
  initial,
  className,
}: {
  number: number;
  initial: IssueState;
  className?: string;
}) {
  const { root } = useWorkspace();
  const { data } = useQuery({ ...issueQuery(root?.path ?? "", number), enabled: false });
  return (
    <IssueIcon state={data?.state ?? initial} reason={data?.stateReason} className={className} />
  );
}
