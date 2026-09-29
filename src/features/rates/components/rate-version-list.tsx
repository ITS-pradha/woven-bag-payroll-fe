import type { RateVersion } from "../api/rates-api";
import { RateStatusBadge } from "./rate-status-badge";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function periodCopy(version: RateVersion) {
  const start = formatDate(version.effectiveFrom);
  if (!version.effectiveToExclusive) return `Mulai ${start}`;
  const exclusive = new Date(`${version.effectiveToExclusive}T00:00:00+07:00`);
  exclusive.setDate(exclusive.getDate() - 1);
  const end = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(exclusive);
  return `${start} – ${end}`;
}

interface RateVersionListProps {
  versions: RateVersion[];
  selectedId: string;
  onSelect: (id: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function RateVersionList({
  versions,
  selectedId,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: RateVersionListProps) {
  return (
    <aside
      className="min-w-0 border border-border bg-surface"
      aria-labelledby="rate-version-list-title"
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
          Riwayat versi
        </p>
        <h2 id="rate-version-list-title" className="text-sm font-bold">
          Daftar harga
        </h2>
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5 lg:max-h-[calc(100vh-13rem)]">
        {versions.map((version) => {
          const selected = version.id === selectedId;
          return (
            <button
              key={version.id}
              type="button"
              aria-pressed={selected}
              className={`mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 border px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-focus ${
                selected
                  ? "border-success-border bg-success-soft"
                  : "border-transparent border-b-border hover:bg-surface-muted"
              }`}
              onClick={() => onSelect(version.id)}
            >
              <strong className="truncate text-xs">{version.code}</strong>
              <RateStatusBadge status={version.status} />
              <span className="mt-0.5 truncate text-[0.6875rem] text-muted">
                {version.name}
              </span>
              <span className="mt-0.5 text-right text-[0.625rem] text-muted">
                {periodCopy(version)}
              </span>
            </button>
          );
        })}
        {hasNextPage ? (
          <button
            type="button"
            className="mt-1 min-h-8 w-full border border-border bg-surface-muted px-2 text-xs font-semibold hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? "Memuat…" : "Tampilkan riwayat lainnya"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
