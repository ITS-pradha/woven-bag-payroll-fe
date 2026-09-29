import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { browseEmployees, DIRECTORY_PAGE_SIZE } from "../api/manual-data-api";

/**
 * HRIS returns the string "0" as a department for some employees — an upstream
 * placeholder, not a code anyone can read. Shown as-is it reads like data
 * ("9664 · 0") and invites the question of which department "0" is.
 */
function departmentLabel(code: string | null | undefined) {
  const value = code?.trim();
  return value && value !== "0" ? value : null;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Nonaktif",
  RESIGNED: "Keluar",
};

/**
 * A read-only employee directory for the gutter beside the grid.
 *
 * It is not the assignee combobox: that one writes into a cell and is bound to
 * whichever row is being edited. This one answers the question an admin has
 * while working the error list — "who is PT2-9217-6896, and what is their
 * PIN?" — without leaving the sheet or losing the half-typed replacement in
 * the fix panel. Hence a copy button rather than a select handler.
 */
export function EmployeeDirectory({
  onClose,
  ...panel
}: { onClose(): void } & React.ComponentPropsWithoutRef<"section">) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  // The confirmation is transient on purpose: a label that stays put stops
  // telling you whether the LAST click worked.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const employees = useQuery({
    queryKey: ["employees", "directory", debounced],
    queryFn: ({ signal }) => browseEmployees(debounced, signal),
    staleTime: 60_000,
    retry: false,
  });
  const data = employees.data?.data ?? [];

  async function copy(pin: string) {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(pin);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // locked-down browsers. Say so instead of silently doing nothing — the
      // PIN is on screen and can still be typed.
      setCopied("");
    }
  }

  return (
    <section
      id="manual-side-panel-directory"
      className="manual-directory"
      aria-label="Data karyawan"
      {...panel}
    >
      {/*
        Sticky, because this panel scrolls: browsing to the fiftieth name used
        to carry the search box off the top of the gutter, so narrowing the
        search meant scrolling back up to find the field.
      */}
      <div className="manual-directory-head">
        <div className="manual-toolbar">
          <h3>Data karyawan</h3>
          <button type="button" className="manual-btn" onClick={onClose}>
            Tutup
          </button>
        </div>
        <label htmlFor={id}>Cari karyawan</label>
        <input
          id={id}
          ref={input}
          value={search}
          placeholder="Nama, PIN, atau EID…"
          onChange={(event) => setSearch(event.target.value)}
        />
        <p className="manual-hint">
          Klik untuk menyalin PIN, lalu tempel ke &ldquo;Ganti
          dengan&hellip;&rdquo;. Karyawan yang sudah keluar ikut ditampilkan.
        </p>
        <p role="status" className="manual-directory-status">
          {copied === null
            ? ""
            : copied === ""
              ? "Peramban menolak akses papan klip. Salin PIN-nya secara manual."
              : `PIN ${copied} disalin.`}
        </p>
      </div>
      {employees.isError ? (
        <p role="alert">
          Data karyawan belum dapat dimuat.{" "}
          <button
            type="button"
            className="manual-link"
            onClick={() => void employees.refetch()}
          >
            Coba lagi
          </button>
        </p>
      ) : (
        <ul className="manual-directory-list">
          {data.map((employee) => (
            <li key={employee.pin}>
              <button type="button" onClick={() => void copy(employee.pin)}>
                <strong>{employee.fullName}</strong>
                <span>
                  <code>{employee.pin}</code>
                  {departmentLabel(employee.departmentCode)
                    ? ` · ${departmentLabel(employee.departmentCode)}`
                    : ""}
                  {employee.employmentStatus === "ACTIVE"
                    ? ""
                    : ` · ${STATUS_LABEL[employee.employmentStatus] ?? employee.employmentStatus}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {employees.isFetching && <p role="status">Memuat…</p>}
      {employees.isSuccess && !data.length && (
        <p>Tidak ada karyawan yang cocok.</p>
      )}
      {/*
        `page.hasNextPage` is not used here: the HRIS-backed directory slices to
        pageSize and never reports a next page, so a full window is the only
        signal that results were cut off.
      */}
      {data.length >= DIRECTORY_PAGE_SIZE && (
        <p>
          {DIRECTORY_PAGE_SIZE} hasil pertama. Persempit pencarian untuk melihat
          sisanya.
        </p>
      )}
    </section>
  );
}
