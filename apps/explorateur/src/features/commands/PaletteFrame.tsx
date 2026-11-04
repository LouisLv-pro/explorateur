import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Cadre commun des palettes (⌘P fichiers, ⌘⇧P commandes) : dialogue centré en haut, champ de
 * recherche et liste qui se parcourt au clavier. Chaque palette fournit ses lignes.
 */
export function PaletteDialog({
  open,
  onOpenChange,
  title,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre lu par les lecteurs d'écran, masqué à l'écran. */
  title: string;
  /** Appelé une fois le dialogue disparu et le focus rendu. */
  onCloseAutoFocus?: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[60vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-hairline bg-canvas shadow-level-3 outline-none"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Ce qu'une ligne reçoit du cadre pour se brancher sur la sélection. */
export type RowProps = {
  id: string;
  selected: boolean;
  onHover: () => void;
  onChoose: () => void;
};

/** Contenu de la palette, monté à l'ouverture : la sélection repart de la première ligne. */
export function PaletteBody<T>({
  query,
  onQueryChange,
  items,
  getKey,
  renderItem,
  onChoose,
  placeholder,
  label,
  listLabel,
  idPrefix,
  emptyMessage,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, row: RowProps) => ReactNode;
  /** Entrée ou clic sur une ligne. */
  onChoose: (item: T) => void;
  placeholder: string;
  /** Nom accessible du champ. */
  label: string;
  /** Nom accessible de la liste. */
  listLabel: string;
  /** Préfixe des `id` de la liste et des lignes (`aria-activedescendant`). */
  idPrefix: string;
  /** Texte affiché à la place de la liste quand elle est vide. */
  emptyMessage: string;
}) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  // Garde la ligne sélectionnée visible quand la liste défile.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, items]);

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (item !== undefined) onChoose(item);
    }
  }

  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActive(0);
        }}
        onKeyDown={onInputKeyDown}
        onFocus={(event) => event.target.select()}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={`${idPrefix}-list`}
        aria-activedescendant={items.length > 0 ? `${idPrefix}-option-${current}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className="h-11 shrink-0 border-b border-hairline bg-transparent px-3 text-body text-ink outline-none placeholder:text-mute"
      />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {items.length > 0 ? (
          <div id={`${idPrefix}-list`} role="listbox" aria-label={listLabel}>
            {items.map((item, index) => (
              <Fragment key={getKey(item)}>
                {renderItem(item, {
                  id: `${idPrefix}-option-${index}`,
                  selected: index === current,
                  onHover: () => setActive(index),
                  onChoose: () => onChoose(item),
                })}
              </Fragment>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-body-sm text-mute">{emptyMessage}</p>
        )}
      </div>
    </>
  );
}

/** Ligne de la liste : fond de sélection, souris et clic branchés sur le cadre. */
export function PaletteOption({ row, children }: { row: RowProps; children: ReactNode }) {
  return (
    <div
      id={row.id}
      role="option"
      aria-selected={row.selected}
      onMouseMove={row.onHover}
      onClick={row.onChoose}
      className={cn(
        "flex h-8 cursor-default items-center gap-2 px-3",
        row.selected && "bg-canvas-soft-2",
      )}
    >
      {children}
    </div>
  );
}
