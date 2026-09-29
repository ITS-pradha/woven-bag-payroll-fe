import { useRef, useState, type FormEvent } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import type { PasswordLoginInput } from "../api/auth-api";

interface LoginFormProps {
  onPasswordLogin: (input: PasswordLoginInput) => Promise<void>;
  /** Leaves the page for the portal; it does not resolve. */
  onSsoLogin: () => void;
  /** Message sent back by the OIDC callback after a failed attempt. */
  ssoError?: string | null;
}

interface FieldErrors {
  pin?: string;
  password?: string;
}

type ActiveMethod = "password" | "sso" | null;

function errorMessageOf(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  return "Login belum berhasil. Silakan coba lagi.";
}

export function LoginForm({ onPasswordLogin, onSsoLogin, ssoError = null }: LoginFormProps) {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(ssoError);
  const [activeMethod, setActiveMethod] = useState<ActiveMethod>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = activeMethod !== null;

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const errors: FieldErrors = {};
    if (!pin.trim()) errors.pin = "PIN wajib diisi.";
    if (!password) errors.password = "Password wajib diisi.";

    setFieldErrors(errors);
    setSubmitError(null);

    if (errors.pin || errors.password) {
      if (errors.pin) pinInputRef.current?.focus();
      else passwordInputRef.current?.focus();
      return;
    }

    setActiveMethod("password");
    try {
      await onPasswordLogin({ pin: pin.trim(), password, rememberMe });
    } catch (error) {
      setSubmitError(errorMessageOf(error));
      setActiveMethod(null);
    }
  }

  function handleSsoLogin() {
    if (isSubmitting) return;

    setFieldErrors({});
    setSubmitError(null);
    // Stays on "Menghubungkan…" on purpose: the next thing that happens is the
    // page leaving for the portal, so there is no success state to render here.
    setActiveMethod("sso");
    onSsoLogin();
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handlePasswordSubmit}>
      {submitError ? (
        <div
          className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <span aria-hidden="true" className="mt-0.5 font-bold">
            !
          </span>
          <span>{submitError}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-foreground"
          htmlFor="pin"
        >
          PIN karyawan
        </label>
        <input
          ref={pinInputRef}
          id="pin"
          name="pin"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={pin}
          aria-describedby={fieldErrors.pin ? "pin-error" : "pin-hint"}
          aria-invalid={Boolean(fieldErrors.pin)}
          className="h-12 w-full rounded-lg border border-border-strong bg-surface px-3.5 text-base text-foreground outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-surface-muted"
          disabled={isSubmitting}
          onChange={(event) => {
            setPin(event.target.value);
            if (fieldErrors.pin) {
              setFieldErrors((current) => {
                const next = { ...current };
                delete next.pin;
                return next;
              });
            }
          }}
        />
        {fieldErrors.pin ? (
          <p id="pin-error" className="text-sm font-medium text-danger">
            {fieldErrors.pin}
          </p>
        ) : (
          <p id="pin-hint" className="text-sm text-muted">
            Gunakan PIN yang terdaftar di HRIS.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-foreground"
          htmlFor="password"
        >
          Password
        </label>
        <div className="relative">
          <input
            ref={passwordInputRef}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            aria-describedby={
              fieldErrors.password ? "password-error" : undefined
            }
            aria-invalid={Boolean(fieldErrors.password)}
            className="h-12 w-full rounded-lg border border-border-strong bg-surface px-3.5 pr-24 text-base text-foreground outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-surface-muted"
            disabled={isSubmitting}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldErrors.password) {
                setFieldErrors((current) => {
                  const next = { ...current };
                  delete next.password;
                  return next;
                });
              }
            }}
          />
          <button
            type="button"
            className="absolute inset-y-1.5 right-1.5 rounded-md px-3 text-sm font-semibold text-brand hover:bg-success-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:text-disabled"
            aria-label={
              showPassword ? "Sembunyikan password" : "Tampilkan password"
            }
            disabled={isSubmitting}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Sembunyikan" : "Lihat"}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id="password-error" className="text-sm font-medium text-danger">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={rememberMe}
          disabled={isSubmitting}
          onChange={(event) => setRememberMe(event.target.checked)}
          className="size-4 rounded border-border-strong accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <span>Ingat saya di perangkat ini</span>
      </label>

      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-brand-disabled"
        disabled={isSubmitting}
      >
        {activeMethod === "password" ? "Memeriksa akun…" : "Masuk"}
      </button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          atau
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-surface px-4 text-sm font-bold text-foreground transition hover:border-brand hover:bg-success-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:text-disabled"
        disabled={isSubmitting}
        onClick={handleSsoLogin}
      >
        <span
          className="grid size-6 place-items-center rounded bg-brand text-[10px] font-black text-white"
          aria-hidden="true"
        >
          SSO
        </span>
        {activeMethod === "sso"
          ? "Menghubungkan Portal…"
          : "Masuk dengan SSO Portal"}
      </button>

      <p className="text-center text-xs leading-5 text-muted">
        Anda akan diarahkan ke halaman Portal untuk masuk, lalu kembali ke sini.
        Password Anda tidak pernah melewati aplikasi ini.
      </p>
    </form>
  );
}
