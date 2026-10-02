import { createContext, useContext } from "react";

export type ToastTone = "success" | "info" | "error";

export interface ToastOptions {
  message: string;
  /** Baris tebal di atas pesan; opsional untuk pesan satu kalimat. */
  title?: string | undefined;
  tone?: ToastTone | undefined;
  /** Milidetik sebelum hilang sendiri. Bawaan per tone, lihat `TOAST_DURATION`. */
  duration?: number | undefined;
}

export type Toast = (options: ToastOptions) => void;

/** Error dibiarkan lebih lama: biasanya ada yang perlu dibaca lalu dikerjakan. */
export const TOAST_DURATION: Record<ToastTone, number> = {
  success: 5_000,
  info: 7_000,
  error: 10_000,
};

export const ToastContext = createContext<Toast | null>(null);

export function useToast(): Toast {
  const toast = useContext(ToastContext);
  // Sama seperti useConfirm: lupa memasang provider harus ketahuan, bukan
  // diam-diam menelan setiap notifikasi.
  if (!toast) throw new Error("useToast dipakai di luar ToastProvider.");
  return toast;
}
