import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { logout } from "../api/auth-api";
import { sessionQueryOptions } from "../api/session-query";

function initials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function roleLabel(role: string | undefined, isSuperAdmin: boolean) {
  if (isSuperAdmin) return "Super Admin";
  if (!role) return "Pengguna";
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ProfileMenu() {
  const sessionQuery = useQuery(sessionQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const session = sessionQuery.data;
  if (!session) return null;
  const label = roleLabel(session.roles[0], session.isSuperAdmin);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Local logout remains mandatory when the network or stale session fails.
    } finally {
      void navigate("/login", { replace: true, flushSync: true });
      queryClient.clear();
    }
  }

  return (
    <div
      ref={root}
      className="relative flex shrink-0 items-center border-l border-border pl-2"
    >
      <button
        ref={trigger}
        type="button"
        className="flex min-h-9 items-center gap-2 rounded px-1.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={`Buka menu profil ${session.user.displayName}`}
        aria-expanded={open}
        aria-controls="profile-menu-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="grid size-6 place-items-center rounded-full bg-brand text-[0.625rem] font-bold text-white"
          aria-hidden="true"
        >
          {initials(session.user.displayName)}
        </span>
        <span className="hidden max-w-32 leading-tight sm:block">
          <span className="block truncate text-xs font-semibold">
            {session.user.displayName}
          </span>
          <span className="block truncate text-[0.625rem] text-muted">
            {label}
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          className="size-3 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <section
          id="profile-menu-panel"
          aria-label="Profil pengguna"
          className="absolute right-0 top-[calc(100%+0.25rem)] z-40 w-56 rounded border border-border bg-surface p-2 shadow-panel"
        >
          <div className="border-b border-border px-2 pb-2">
            <p className="truncate text-sm font-semibold">
              {session.user.displayName}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">{label}</p>
          </div>
          <button
            type="button"
            className="mt-1 flex min-h-9 w-full items-center rounded px-2 text-sm font-semibold text-danger hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
          >
            {loggingOut ? "Sedang keluar…" : "Keluar"}
          </button>
        </section>
      )}
    </div>
  );
}
