import { useEffect, useId, useRef, useState } from "react";

/**
 * Menu kecil untuk aksi toolbar yang jarang dipakai.
 *
 * Bukan `<details>`: menu harus tertutup sendiri saat klik di luar, Escape,
 * atau setelah satu aksi dipilih, dan fokus kembali ke tombolnya. Tiap item
 * boleh membawa alasan kenapa ia nonaktif — ditulis di dalam menu, karena
 * tooltip `title` tidak pernah sampai ke keyboard maupun layar sentuh.
 */
export interface ToolbarMenuItem {
  label: string;
  /** Teks yang dibacakan, bila berbeda dari label (mis. menyebut jumlah). */
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
  /** Ditampilkan di bawah label saat item nonaktif. */
  reason?: string | undefined;
  tone?: "danger" | undefined;
  onSelect(): void;
}

export function ToolbarMenu({
  label,
  items,
}: {
  label: string;
  items: readonly ToolbarMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    root
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="manual-menu"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const enabled = [
          ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ) ?? []),
        ];
        const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "ArrowDown"
            ? (at + 1) % enabled.length
            : (at - 1 + enabled.length) % enabled.length;
        enabled[next]?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="manual-btn manual-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path
            d="m3 4.5 3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div id={menuId} role="menu" className="manual-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              aria-label={item.ariaLabel}
              className="manual-menu-item"
              data-tone={item.tone}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.disabled && item.reason ? (
                <small>{item.reason}</small>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
