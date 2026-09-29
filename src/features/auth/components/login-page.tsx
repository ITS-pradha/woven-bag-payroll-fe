import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";

import {
  loginWithPassword,
  type AuthSession,
  type PasswordLoginInput,
} from "../api/auth-api";
import { env } from "../../../config/env";
import { sessionQueryKey } from "../api/session-query";
import { LoginForm } from "./login-form";

function destinationFromState(state: unknown): string {
  if (
    typeof state === "object" &&
    state !== null &&
    "from" in state &&
    typeof state.from === "string" &&
    state.from.startsWith("/") &&
    !state.from.startsWith("//") &&
    state.from !== "/login"
  ) {
    return state.from;
  }

  return "/manual-data";
}

/**
 * The callback sends failures back as `?sso_error=`, because a browser that
 * arrived by navigation cannot be handed a JSON error body.
 */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  // Satu kode untuk dua sebab, menurut spesifikasi OAuth: pemakai menekan Batal, atau akunnya
  // belum diberi akses. Portal tidak membedakannya, jadi pesannya pun tidak boleh menebak.
  access_denied:
    "Login lewat Portal tidak dilanjutkan — dibatalkan, atau akun Anda belum diberi akses ke aplikasi ini.",
  consent_required: "Permintaan akses belum disetujui di Portal.",
  login_required: "Sesi Portal sudah berakhir. Silakan masuk lagi.",
  state_missing: "Proses login kedaluwarsa. Silakan ulangi dari awal.",
  portal_unavailable: "Portal tidak dapat dihubungi. Coba lagi beberapa saat lagi.",
  rejected: "Portal menolak permintaan login ini.",
};

function ssoErrorMessage(search: string): string | null {
  const code = new URLSearchParams(search).get("sso_error");

  if (!code) return null;

  return SSO_ERROR_MESSAGES[code] ?? "Login lewat Portal belum berhasil.";
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  function finishLogin(session: AuthSession) {
    queryClient.setQueryData(sessionQueryKey, session);
    void navigate(destinationFromState(location.state), { replace: true });
  }

  async function handlePasswordLogin(input: PasswordLoginInput) {
    finishLogin(await loginWithPassword(input));
  }

  /**
   * SSO is a full-page trip to the portal, not an API call: the user signs in
   * on the portal's own pages and comes back with a session already set. There
   * is nothing to await here — the page is leaving.
   */
  function handleSsoLogin() {
    window.location.assign(`${env.VITE_API_BASE_URL}/auth/oidc/start`);
  }

  return (
    <main className="min-h-screen bg-app lg:grid lg:grid-cols-[minmax(24rem,0.9fr)_minmax(32rem,1.1fr)]">
      <section
        className="relative hidden min-h-screen overflow-hidden bg-brand-strong p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16"
        aria-label="Tentang Woven Payroll"
      >
        <div
          className="absolute -right-24 top-28 size-72 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div
          className="absolute -right-8 top-44 size-44 rounded-full border border-white/10"
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg border border-white/20 bg-white text-sm font-black tracking-tight text-brand-strong">
            WP
          </span>
          <div>
            <p className="font-bold tracking-tight">Woven Payroll</p>
            <p className="text-xs text-white/65">PT Prakarsa Alam Segar</p>
          </div>
        </div>

        <div className="relative max-w-xl py-12">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">
            Sistem penggajian operator
          </p>
          <h2 className="text-4xl font-bold leading-[1.15] tracking-tight xl:text-5xl">
            Data produksi yang rapi. Perhitungan upah yang dapat ditelusuri.
          </h2>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/72">
            Kelola hasil mesin Lohia dan LDMS, validasi hari kerja, lalu siapkan
            payroll operator dalam satu alur kerja.
          </p>

          <div
            className="mt-10 grid max-w-lg grid-cols-3 gap-3"
            aria-label="Alur kerja aplikasi"
          >
            {[
              ["01", "Input produksi"],
              ["02", "Validasi data"],
              ["03", "Payroll"],
            ].map(([number, label]) => (
              <div key={number} className="border-t border-white/25 pt-3">
                <span className="block text-xs font-bold text-emerald-200">
                  {number}
                </span>
                <span className="mt-1 block text-sm font-semibold text-white/90">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/65">
          Akses terbatas untuk pengguna yang memiliki izin payroll.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-12 xl:px-20">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-lg bg-brand text-sm font-black text-white">
              WP
            </span>
            <div>
              <p className="font-bold tracking-tight text-foreground">
                Woven Payroll
              </p>
              <p className="text-xs text-muted">Operator Lohia &amp; LDMS</p>
            </div>
          </div>

          <header className="mb-8">
            <p className="mb-2 text-sm font-bold text-brand">Selamat datang</p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Masuk ke akun Anda
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Gunakan PIN HRIS dan password Anda, atau lanjutkan dengan sesi
              Portal yang aktif.
            </p>
          </header>

          <LoginForm
            onPasswordLogin={handlePasswordLogin}
            onSsoLogin={handleSsoLogin}
            ssoError={ssoErrorMessage(location.search)}
          />

          <footer className="mt-9 border-t border-border pt-5 text-center text-xs leading-5 text-muted">
            Kesulitan masuk? Hubungi HRD atau administrator sistem.
          </footer>
        </div>
      </section>
    </main>
  );
}
