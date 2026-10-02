import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchEmployees } from "../api/manual-data-api";
import type { Employee } from "../model/rows";

export function EmployeePicker({
  onSelect,
  focusRequest,
  disabled,
  onDismiss,
}: {
  onSelect(employee: Employee): void;
  focusRequest: number;
  disabled: boolean;
  onDismiss?(): void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const employees = useQuery({
    queryKey: ["employees", "search", debounced],
    queryFn: ({ signal }) => searchEmployees(debounced, signal),
    enabled: open && !disabled,
    staleTime: 60_000,
    retry: false,
  });
  const data = employees.data?.data ?? [];
  /**
   * The list answers the text in the box. While the debounce or the request
   * is still catching up it answers the previous text, and Enter would pick
   * that list's first row — an employee nobody searched for.
   */
  const settled = search.trim() === debounced && !employees.isFetching;
  function choose(employee: Employee) {
    onSelect(employee);
    setSearch("");
    setOpen(false);
    input.current?.focus();
  }
  return (
    <div className="manual-picker">
      <label htmlFor={id}>Cari assignee</label>
      <input
        id={id}
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          open && data[active] ? `${id}-${active}` : undefined
        }
        disabled={disabled}
        value={search}
        placeholder="Cari nama, PIN, atau EID karyawan…"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setSearch(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            onDismiss?.();
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
          if (event.key === "Enter" && open) {
            event.preventDefault();
            const employee = data[active];
            if (settled && employee) choose(employee);
          }
        }}
      />
      {open && (
        <div className="manual-picker-results">
          <div role="listbox" id={`${id}-list`} aria-label="Karyawan tersedia">
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
                <span>PIN {employee.pin}</span>
              </button>
            ))}
          </div>
          {employees.isFetching && <p role="status">Mencari karyawan…</p>}
          {employees.isError && (
            <p role="alert">
              Karyawan belum dapat dimuat.{" "}
              <button type="button" onClick={() => void employees.refetch()}>
                Coba lagi
              </button>
            </p>
          )}
          {employees.isSuccess && !data.length && (
            <p>Tidak ada karyawan yang cocok.</p>
          )}
          {employees.data?.page.hasNextPage && (
            <p>20 hasil pertama. Persempit pencarian.</p>
          )}
          <button
            type="button"
            className="manual-btn"
            onClick={() => {
              setOpen(false);
              onDismiss?.();
            }}
          >
            Tutup daftar
          </button>
        </div>
      )}
    </div>
  );
}
