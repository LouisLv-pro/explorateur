import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

type NameFieldProps = {
  /** Icône du type d'entrée (fichier, dossier) à gauche du champ. */
  icon: ReactNode;
  /** Retrait de la ligne, comme celui des entrées de l'arborescence. */
  style: CSSProperties;
  /** Nom de départ (vide pour une création). */
  initial?: string;
  /** Fin de la sélection initiale (défaut : tout le nom). */
  selectEnd?: number;
  /** Libellé accessible du champ. */
  label: string;
  /**
   * Valide le nom saisi. Renvoie le message à afficher sous le champ (le champ reste ouvert avec
   * le nom saisi), ou `null` quand c'est fini (le parent ferme le champ).
   */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
};

/** Attribut du champ de nom ouvert (un seul à la fois), pour `focusNameField`. */
const FIELD_ATTR = "data-name-field";

/** Donne le focus au champ de nom ouvert, s'il y en a un (fermeture d'un menu contextuel). */
export function focusNameField() {
  document.querySelector<HTMLInputElement>(`[${FIELD_ATTR}]`)?.focus();
}

/**
 * Champ de nom en place dans l'arborescence, partagé par la création et le renommage.
 * Entrée, ou perte du focus avec un nom : valide. Échap, ou perte du focus avec un nom vide :
 * annule.
 */
export function NameField({
  icon,
  style,
  initial = "",
  selectEnd,
  label,
  onSubmit,
  onCancel,
}: NameFieldProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Une validation à la fois : Entrée puis la perte de focus qui suit ne valident pas deux fois.
  const busy = useRef(false);
  const errorId = useId();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, selectEnd ?? input.value.length);
    input.scrollIntoView({ block: "nearest" });
    // Au montage seulement : la sélection initiale ne doit pas revenir à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (busy.current) return;
    busy.current = true;
    try {
      setError(await onSubmit(value));
    } finally {
      busy.current = false;
    }
  }

  return (
    <div>
      <div style={style} className="flex h-6.5 w-full items-center gap-1 pr-2">
        <span className="size-3.5 shrink-0" />
        <span className="shrink-0 text-mute [&_svg]:size-4">{icon}</span>
        <input
          ref={inputRef}
          {...{ [FIELD_ATTR]: "" }}
          type="text"
          value={value}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          onBlur={() => {
            if (value.trim() === "") onCancel();
            else void submit();
          }}
          className="h-5.5 min-w-0 flex-1 rounded-sm border border-ring bg-canvas px-1 text-body-sm text-ink outline-none"
        />
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          style={{ paddingLeft: Number(style.paddingLeft ?? 0) + 22 }}
          className="pr-2 pb-1 text-body-sm text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
