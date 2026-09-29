export function RouteHydrationFallback() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-app px-4"
      role="status"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-muted">
        <span
          className="size-2 animate-pulse rounded-full bg-brand"
          aria-hidden="true"
        />
        Memuat halaman…
      </div>
    </div>
  );
}
