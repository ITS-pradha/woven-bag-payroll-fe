import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import "./toast.css";
import {
  TOAST_DURATION,
  ToastContext,
  type Toast,
  type ToastOptions,
  type ToastTone,
} from "./use-toast";

/**
 * Notifikasi singkat di pojok layar untuk hasil aksi yang sudah selesai
 * ("Buku KARUNG-2026-09 diperbarui"). Bukan pengganti pesan validasi atau
 * error yang harus tetap terlihat di dekat datanya — itu tetap di halaman.
 *
 * Hilang sendiri, tapi jedanya berhenti selama kursor atau fokus keyboard ada
 * di atasnya, supaya pesan tidak lenyap di tengah dibaca.
 */
interface Item extends ToastOptions {
  id: number;
  tone: ToastTone;
}

/** Lebih dari ini, yang paling lama dibuang duluan. */
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);
  const toast = useCallback<Toast>((options) => {
    const id = (nextId.current += 1);
    setItems((current) =>
      [...current, { ...options, id, tone: options.tone ?? "success" }].slice(
        -MAX_VISIBLE,
      ),
    );
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <section className="toast-region" aria-label="Notifikasi">
        <ol>
          {items.map((item) => (
            <ToastItem key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({
  item,
  onDismiss,
}: {
  item: Item;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration ?? TOAST_DURATION[item.tone]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(
      () => onDismiss(item.id),
      remaining.current,
    );
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - startedAt),
      );
    };
  }, [paused, item.id, onDismiss]);

  return (
    <li
      className="toast"
      data-tone={item.tone}
      // Error diumumkan segera; sukses/info menunggu pembaca layar selesai.
      role={item.tone === "error" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPaused(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        <ToneIcon tone={item.tone} />
      </span>
      <div className="toast-body">
        {item.title ? <p className="toast-title">{item.title}</p> : null}
        <p className="toast-message">{item.message}</p>
      </div>
      <button
        type="button"
        className="toast-close"
        aria-label="Tutup notifikasi"
        onClick={() => onDismiss(item.id)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="m4.5 4.5 7 7M11.5 4.5l-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span
        className="toast-timer"
        data-paused={paused || undefined}
        style={{
          animationDuration: `${item.duration ?? TOAST_DURATION[item.tone]}ms`,
        }}
        aria-hidden="true"
      />
    </li>
  );
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  const path =
    tone === "success"
      ? "m4 8.4 2.7 2.7L12 5.4"
      : tone === "error"
        ? "M8 4.6v4M8 11.2v.1"
        : "M8 7.4v4M8 4.8v.1";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
