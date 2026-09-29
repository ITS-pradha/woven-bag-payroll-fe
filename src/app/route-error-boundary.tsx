import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} — Halaman bermasalah`
    : "Halaman gagal dimuat";

  return (
    <main className="grid min-h-screen place-items-center bg-app px-4">
      <section className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-panel">
        <p className="text-xs font-bold uppercase tracking-widest text-danger">
          Terjadi kesalahan
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Muat ulang halaman. Jika masalah tetap terjadi, catat waktu kejadian
          dan hubungi tim aplikasi.
        </p>
        <Link
          to="/manual-data"
          className="mt-5 inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Kembali ke Manual Data
        </Link>
      </section>
    </main>
  );
}
