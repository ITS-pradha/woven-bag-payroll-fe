import { createContext, useContext, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** Label tombol setuju. Sebut aksinya ("Hapus 12 baris"), bukan "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` untuk aksi yang membuang atau menghapus sesuatu. */
  tone?: "danger" | "primary";
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  // Sengaja melempar, bukan jatuh ke window.confirm: fallback diam-diam akan
  // menyembunyikan halaman yang lupa dibungkus provider.
  if (!confirm) throw new Error("useConfirm dipakai di luar ConfirmProvider.");
  return confirm;
}
