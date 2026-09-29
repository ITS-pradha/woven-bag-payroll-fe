import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { browseEmployees } from "../api/manual-data-api";
import type { Employee } from "../model/rows";

/**
 * The replacement field in the fix panel, with employee search attached.
 *
 * It stays a free text input rather than a select: a PIN or an EID typed by
 * hand is a perfectly good answer, and an admin who knows the number should
 * not have to go through a menu. The dropdown is there because the value
 * usually has to be looked up — before it, correcting "PT2-9217-6896" meant
 * switching to the Data karyawan tab, searching, copying a PIN, switching
 * back, and pasting.
 *
 * Results render IN FLOW, not floating: this lives inside a panel with
 * `overflow: auto`, which would clip an absolutely positioned menu at the
 * panel edge rather than let it hang over the grid.
 */
export function EmployeeCombobox({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  label: string;
}) {
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const employees = useQuery({
    queryKey: ["employees", "directory", debounced],
    queryFn: ({ signal }) => browseEmployees(debounced, signal),
    enabled: open && !disabled,
    staleTime: 60_000,
    retry: false,
  });
  const data = employees.data?.data ?? [];

  function choose(employee: Employee) {
    // The PIN, not the name: the grid resolves identities, and a name is not
    // one — two people can share it.
    onChange(employee.pin);
    setPicked(`${employee.fullName} · ${employee.pin}`);
    setOpen(false);
  }

  return (
    <div
      className="manual-fix-combo"
      ref={box}
      onBlur={(event) => {
        // Only when focus actually leaves the widget, or clicking an option
        // would close the list before the click lands.
        if (!box.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          open && data[active] ? `${id}-${active}` : undefined
        }
        aria-label={label}
        value={value}
        placeholder="PIN, EID, atau cari nama…"
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setPicked(null);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              Math.min(index + 1, Math.max(0, data.length - 1)),
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          }
          // Enter picks the highlighted employee instead of submitting the
          // form it sits in — applying a half-typed search would rewrite every
          // matching cell with nonsense.
          if (event.key === "Enter" && open && data[active]) {
            event.preventDefault();
            choose(data[active]);
          }
        }}
      />
      {picked && <p className="manual-fix-picked">{picked}</p>}
      {open && (
        <div className="manual-fix-options">
          <div role="listbox" id={`${id}-list`} aria-label="Karyawan">
            {data.map((employee, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                id={`${id}-${index}`}
                key={employee.pin}
                onClick={() => choose(employee)}
              >
                <strong>{employee.fullName}</strong>
                <span>{employee.pin}</span>
              </button>
            ))}
          </div>
          {employees.isFetching && <p role="status">Mencari…</p>}
          {employees.isError && (
            <p role="alert">Karyawan belum dapat dimuat.</p>
          )}
          {employees.isSuccess && !data.length && <p>Tidak ada yang cocok.</p>}
        </div>
      )}
    </div>
  );
}
