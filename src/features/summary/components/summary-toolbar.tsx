export type SummaryViewFilter = "ALL" | "OVERRIDE" | "BLOCKING";

export function SummaryToolbar({
  query,
  view,
  reason,
  selectedCount,
  dirtyCount,
  editable,
  saving,
  onQueryChange,
  onViewChange,
  onReasonChange,
  onApplyFilter,
  onCopy,
  onPaste,
  onDiscard,
  onSave,
}: {
  query: string;
  view: SummaryViewFilter;
  reason: string;
  selectedCount: number;
  dirtyCount: number;
  editable: boolean;
  saving: boolean;
  onQueryChange: (value: string) => void;
  onViewChange: (value: SummaryViewFilter) => void;
  onReasonChange: (value: string) => void;
  onApplyFilter: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <section
      className="flex flex-wrap items-end gap-1.5 border border-border bg-surface px-2 py-1.5"
      aria-label="Kontrol summary"
    >
      <label className="min-w-40 flex-1 text-[0.625rem] font-semibold">
        Cari karyawan
        <input
          type="search"
          aria-label="Cari karyawan"
          placeholder="Nama atau PIN"
          className="mt-0.5 block h-7 w-full border border-border-strong px-2 text-xs focus:outline-2 focus:outline-focus"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApplyFilter();
          }}
        />
      </label>
      <label className="text-[0.625rem] font-semibold">
        Tampilkan
        <select
          aria-label="Filter status summary"
          className="mt-0.5 block h-7 border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
          value={view}
          onChange={(event) =>
            onViewChange(event.target.value as SummaryViewFilter)
          }
        >
          <option value="ALL">Semua</option>
          <option value="OVERRIDE">Sudah override</option>
          <option value="BLOCKING">Perlu dicek</option>
        </select>
      </label>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 text-xs font-semibold"
        onClick={onApplyFilter}
      >
        Terapkan
      </button>
      {editable ? (
        <>
          <label className="min-w-52 flex-[2] text-[0.625rem] font-semibold">
            Alasan override
            <input
              aria-label="Alasan override"
              placeholder="Wajib minimal 5 karakter"
              className="mt-0.5 block h-7 w-full border border-border-strong px-2 text-xs focus:outline-2 focus:outline-focus"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="h-7 border border-border-strong px-2 text-xs font-semibold disabled:text-disabled"
            disabled={selectedCount === 0}
            onClick={onCopy}
          >
            Salin ({selectedCount})
          </button>
          <button
            type="button"
            className="h-7 border border-border-strong px-2 text-xs font-semibold disabled:text-disabled"
            disabled={selectedCount === 0}
            onClick={onPaste}
          >
            Tempel
          </button>
          {dirtyCount > 0 ? (
            <button
              type="button"
              className="h-7 border border-border-strong px-2 text-xs font-semibold"
              onClick={onDiscard}
            >
              Batal ({dirtyCount})
            </button>
          ) : null}
          <button
            type="button"
            className="h-7 rounded bg-brand px-2 text-xs font-bold text-white disabled:bg-brand-disabled"
            disabled={dirtyCount === 0 || saving || reason.trim().length < 5}
            onClick={onSave}
          >
            {saving ? "Menyimpan…" : `Simpan (${dirtyCount})`}
          </button>
        </>
      ) : null}
    </section>
  );
}
