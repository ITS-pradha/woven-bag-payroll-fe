import { Link } from "react-router-dom";

export function Component() {
  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-panel">
      <p className="text-xs font-bold uppercase tracking-widest text-muted">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 text-sm text-muted">
        Alamat yang dibuka tidak tersedia pada aplikasi payroll.
      </p>
      <Link
        to="/manual-data"
        className="mt-5 inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Buka Manual Data
      </Link>
    </section>
  );
}
