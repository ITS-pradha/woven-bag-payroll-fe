export function DetailPagination({
  pageIndex,
  hasNext,
  onPrevious,
  onNext,
}: {
  pageIndex: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <footer className="flex items-center justify-end gap-2 border-x border-b border-border bg-surface px-2 py-1 text-[0.6875rem]">
      <span>Halaman {pageIndex + 1}</span>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold disabled:text-disabled"
        disabled={pageIndex === 0}
        onClick={onPrevious}
      >
        Sebelumnya
      </button>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold disabled:text-disabled"
        disabled={!hasNext}
        onClick={onNext}
      >
        Berikutnya
      </button>
    </footer>
  );
}
