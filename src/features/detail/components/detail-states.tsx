import type { ReactNode } from "react";

export function DetailTabButton({
  active,
  controls,
  onClick,
  children,
}: {
  active: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      className="min-h-8 border-b-2 border-transparent px-3 text-xs font-semibold aria-selected:border-brand aria-selected:text-brand-strong"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DetailLineState({
  pending,
  error,
  empty,
  onRetry,
  children,
}: {
  pending: boolean;
  error: boolean;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (pending)
    return (
      <div
        aria-busy="true"
        aria-label="Memuat rincian"
        className="min-h-64 flex-1 animate-pulse border border-border bg-surface-muted"
      />
    );
  if (error) return <DetailError onRetry={onRetry} />;
  if (empty)
    return (
      <p className="flex min-h-48 items-center justify-center border border-border bg-surface text-xs text-muted">
        Tidak ada data pada bagian ini.
      </p>
    );
  return children;
}

export function DetailLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Memuat detail payroll"
      className="h-64 animate-pulse border border-border bg-surface-muted"
    />
  );
}

export function DetailError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="flex items-center justify-between border border-danger/30 bg-surface p-4 text-xs"
    >
      <p>Detail payroll belum dapat dimuat.</p>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold"
        onClick={onRetry}
      >
        Coba lagi
      </button>
    </section>
  );
}
