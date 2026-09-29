import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import type { PayrollRun, PayrollSummary } from "../api/detail-api";
import { payrollEmployeeSearchOptions } from "../api/detail-queries";
import { formatDateTimeWib } from "../model/detail-format";

export function DetailSelector({
  runs,
  runId,
  selectedPin,
  hasMoreRuns,
  loadingMoreRuns,
  onRunChange,
  onEmployeeSelect,
  onLoadMoreRuns,
}: {
  runs: PayrollRun[];
  runId: string;
  selectedPin: string;
  hasMoreRuns: boolean;
  loadingMoreRuns: boolean;
  onRunChange: (runId: string) => void;
  onEmployeeSelect: (employee: PayrollSummary) => void;
  onLoadMoreRuns: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const employees = useQuery({
    ...payrollEmployeeSearchOptions(runId, debouncedSearch),
    enabled: Boolean(runId && open),
    retry: false,
  });
  const results = employees.data?.data ?? [];

  function choose(employee: PayrollSummary) {
    onEmployeeSelect(employee);
    setSearch(employee.employeeName);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <section
      aria-label="Pilih payroll dan karyawan"
      className="flex flex-wrap items-end gap-1.5 border border-border bg-surface px-2 py-1.5"
    >
      <label className="min-w-60 flex-1 text-[0.625rem] font-semibold">
        Payroll run
        <select
          aria-label="Pilih payroll run"
          className="mt-0.5 block h-7 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
          value={runId}
          onChange={(event) => {
            setSearch("");
            setOpen(false);
            onRunChange(event.target.value);
          }}
        >
          {!runs.some((run) => run.id === runId) && runId ? (
            <option value={runId}>Run terpilih</option>
          ) : null}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              Run {run.runNo} · {formatDateTimeWib(run.createdAt)} ·{" "}
              {run.status}
            </option>
          ))}
        </select>
      </label>
      {hasMoreRuns ? (
        <button
          type="button"
          className="h-7 border border-border-strong px-2 text-xs font-semibold disabled:text-disabled"
          disabled={loadingMoreRuns}
          onClick={onLoadMoreRuns}
        >
          {loadingMoreRuns ? "Memuat…" : "Muat histori"}
        </button>
      ) : null}
      <div
        className="relative min-w-60 flex-[1.3]"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <label
          htmlFor={`${listId}-input`}
          className="text-[0.625rem] font-semibold"
        >
          Cari karyawan
        </label>
        <input
          id={`${listId}-input`}
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && results[activeIndex]
              ? `${listId}-${results[activeIndex].pin}`
              : undefined
          }
          disabled={!runId}
          placeholder={
            selectedPin ? `PIN terpilih ${selectedPin}` : "Nama atau PIN"
          }
          className="mt-0.5 block h-7 w-full border border-border-strong px-2 text-xs focus:outline-2 focus:outline-focus disabled:bg-surface-muted"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.min(index + 1, Math.max(0, results.length - 1)),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter" && open && results[activeIndex]) {
              event.preventDefault();
              choose(results[activeIndex]);
            }
          }}
        />
        {open ? (
          <div className="absolute inset-x-0 top-full z-30 border border-border-strong bg-surface shadow-panel">
            <div
              id={listId}
              role="listbox"
              aria-label="Karyawan dalam payroll run"
              className="max-h-56 overflow-auto p-1"
            >
              {results.map((employee, index) => (
                <button
                  key={employee.pin}
                  id={`${listId}-${employee.pin}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className="flex min-h-8 w-full items-center justify-between gap-3 px-2 text-left text-xs hover:bg-surface-muted aria-selected:bg-info-soft"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(employee)}
                >
                  <strong>{employee.employeeName}</strong>
                  <span className="text-muted">· PIN {employee.pin}</span>
                </button>
              ))}
            </div>
            {employees.isFetching ? (
              <p
                role="status"
                className="border-t border-border px-2 py-1 text-xs"
              >
                Mencari karyawan…
              </p>
            ) : null}
            {employees.isSuccess && results.length === 0 ? (
              <p className="border-t border-border px-2 py-1 text-xs text-muted">
                Karyawan tidak ditemukan pada run ini.
              </p>
            ) : null}
            {employees.isError ? (
              <p
                role="alert"
                className="border-t border-border px-2 py-1 text-xs text-danger"
              >
                Daftar karyawan belum dapat dimuat.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
