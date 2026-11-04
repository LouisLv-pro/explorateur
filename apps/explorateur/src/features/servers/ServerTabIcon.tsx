import { Globe } from "lucide-react";
import { useServers } from "./context";
import { serverStatus } from "./model";
import { StatusDot } from "./StatusDot";

/** Icône de l'onglet d'aperçu d'un serveur : globe et pastille d'état. */
export function ServerTabIcon({ serverKey }: { serverKey: string }) {
  const { serverOf, runs } = useServers();
  const server = serverOf(serverKey);
  return (
    <span className="relative flex shrink-0">
      <Globe className="size-4" aria-hidden />
      {server !== undefined && (
        <StatusDot
          status={serverStatus(server, runs.get(serverKey))}
          className="absolute -right-0.5 -bottom-0.5 size-1.5 ring-1 ring-canvas-soft"
        />
      )}
    </span>
  );
}
