import { NavLink, Outlet } from "react-router-dom";

import { ProfileMenu } from "../features/auth/components/profile-menu";

const primaryNavigation = [
  { to: "/manual-data", label: "Manual Data" },
  { to: "/detail", label: "Detail" },
  { to: "/summary", label: "Summary" },
  { to: "/rates", label: "Konfigurasi Harga" },
] as const;

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return [
    "inline-flex min-h-10 items-center border-b-2 px-1 text-xs font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
    isActive
      ? "border-brand text-brand-strong"
      : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
  ].join(" ");
}

export function AppShell() {
  return (
    <div className="min-h-screen bg-app text-foreground">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-panel transition-transform focus:translate-y-0"
      >
        Lewati ke konten
      </a>

      <header className="border-b border-border bg-surface">
        <div className="flex min-h-10 w-full items-stretch px-2">
          <div className="flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto">
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className="grid size-6 shrink-0 place-items-center rounded bg-brand text-[0.625rem] font-bold tracking-tight text-white"
                aria-hidden="true"
              >
                WP
              </span>
              <p className="text-xs font-bold tracking-tight">Woven Payroll</p>
            </div>

            <nav aria-label="Menu utama" className="flex min-w-max gap-4">
              {primaryNavigation.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={navLinkClassName}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ProfileMenu />
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-screen-2xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
