import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DisplayMode } from "../display";
import { Message } from "../Message";
import "./data.css";
import type { DataFormat } from "./formats";
import { invalidMessage, parseCsv, parseJson, parseYaml, type Parsed } from "./parse";
import { TableView } from "./TableView";
import { initialState, reconcile, type TreeState } from "./tree";
import { TreeView } from "./TreeView";

type Props = {
  /** Texte du document (valeur différée de l'éditeur). */
  text: string;
  format: DataFormat;
  /** Mode d'affichage : `source` ne monte pas `DataView` ; `split` a déjà la source à gauche. */
  mode: DisplayMode;
  /** Éditeur de la source, montré sous la bannière quand le fichier est invalide en mode Aperçu. */
  source: ReactNode;
  /** Identifie le fichier : un autre fichier dans le même onglet repart d'un état neuf. */
  fileKey: string;
};

/**
 * Aperçu d'un CSV ou TSV (tableau), d'un JSON ou YAML (arbre). Un fichier vide dit « Fichier
 * vide. » ; un fichier invalide, une bannière (et la source en mode Aperçu).
 */
export function DataView({ text, format, mode, source, fileKey }: Props) {
  const { t } = useTranslation("preview");
  if (text.trim() === "") return <Message>{t("data.empty")}</Message>;
  return format === "csv" || format === "tsv" ? (
    <TableData key={fileKey} text={text} format={format} mode={mode} source={source} />
  ) : (
    <TreeData key={fileKey} text={text} format={format} mode={mode} source={source} />
  );
}

/** Bannière `role="alert"` d'un fichier invalide, suivie de la source en mode Aperçu. */
function Invalid({
  message,
  mode,
  source,
}: {
  message: string;
  mode: DisplayMode;
  source: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="alert"
        className="flex shrink-0 items-center gap-3 border-b border-hairline bg-warning-soft py-1.5 pr-3 pl-4 text-body-sm text-ink"
      >
        <CircleAlert className="size-4 shrink-0 text-warning-deep" aria-hidden />
        <span className="max-h-24 min-w-0 flex-1 overflow-y-auto break-words">{message}</span>
      </div>
      {mode === "rendered" && source}
    </div>
  );
}

function TableData({
  text,
  format,
  mode,
  source,
}: Omit<Props, "fileKey" | "format"> & { format: "csv" | "tsv" }) {
  const { t } = useTranslation("preview");
  // Mémoïsée sur le texte : un changement de mode ou de thème ne relance pas l'analyse.
  const parsed = useMemo(() => parseCsv(text, format), [text, format]);
  if (!parsed.ok) {
    return <Invalid message={invalidMessage(format, parsed.error)} mode={mode} source={source} />;
  }
  if (parsed.value.rows.length === 0) return <Message>{t("data.empty")}</Message>;
  return <TableView table={parsed.value} />;
}

/** JSON : analyse synchrone. YAML : le module `yaml` se charge à la première analyse. */
function useParsedTree(text: string, format: DataFormat): Parsed<unknown> | undefined {
  const json = useMemo(() => (format === "json" ? parseJson(text) : undefined), [text, format]);
  const [yaml, setYaml] = useState<Parsed<unknown>>();
  useEffect(() => {
    if (format !== "yaml") return;
    let current = true;
    void parseYaml(text).then((result) => {
      if (current) setYaml(result);
    });
    return () => {
      current = false;
    };
  }, [text, format]);
  // Pendant l'analyse d'un nouveau texte YAML, le résultat précédent reste affiché.
  return format === "json" ? json : yaml;
}

function TreeData({ text, format, mode, source }: Omit<Props, "fileKey">) {
  // Redessine la bannière d'erreur (`invalidMessage`) au changement de langue.
  useTranslation("preview");
  const parsed = useParsedTree(text, format);
  // Dernière valeur valide et son état déplié : gardés pendant que le texte est invalide, pour
  // retrouver les nœuds ouverts dès qu'il redevient valide.
  const [tree, setTree] = useState<{ value: unknown; state: TreeState }>();

  if (parsed?.ok && tree?.value !== parsed.value) {
    setTree({
      value: parsed.value,
      state: tree ? reconcile(parsed.value, tree.state) : initialState(parsed.value),
    });
  }

  if (!parsed) return null;
  if (!parsed.ok) {
    return <Invalid message={invalidMessage(format, parsed.error)} mode={mode} source={source} />;
  }
  // Le rendu où `tree` retarde sur `parsed` est jeté par React : `setTree` ci-dessus le relance.
  if (!tree || tree.value !== parsed.value) return null;
  return (
    <TreeView
      value={tree.value}
      expanded={tree.state.expanded}
      onExpandedChange={(expanded) => setTree({ ...tree, state: { ...tree.state, expanded } })}
    />
  );
}
