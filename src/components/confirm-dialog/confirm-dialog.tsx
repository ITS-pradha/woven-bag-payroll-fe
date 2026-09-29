import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ConfirmContext,
  type Confirm,
  type ConfirmOptions,
} from "./use-confirm";

/**
 * Konfirmasi sebagai modal milik aplikasi, pengganti `window.confirm`.
 *
 * `window.confirm` tidak bisa diberi judul atau gaya, membekukan seluruh tab
 * selama terbuka (termasuk timer dan request yang sedang jalan), dan di
 * beberapa browser bisa dimatikan pengguna lewat "cegah halaman membuat
 * dialog" — setelah itu setiap konfirmasi diam-diam dijawab tidak.
 *
 * Bentuk pemakaiannya sengaja sama dengan yang diganti: satu pemanggilan yang
 * menjawab ya/tidak, hanya saja lewat Promise.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title, message, confirmLabel, tone: "danger" }))) return;
 *
 * Satu hal yang TIDAK bisa diganti: peringatan saat tab ditutup atau dimuat
 * ulang (`beforeunload`). Browser tidak mengizinkan halaman menampilkan
 * dialognya sendiri di sana.
 */
interface Pending extends ConfirmOptions {
  id: number;
  resolve(answer: boolean): void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  // Antrean, bukan satu slot: dua konfirmasi yang datang bersamaan (mis.
  // navigasi terblokir saat dialog lain terbuka) dijawab bergiliran, tidak
  // saling menimpa dan meninggalkan satu Promise yang tidak pernah selesai.
  const [queue, setQueue] = useState<Pending[]>([]);
  const nextId = useRef(0);
  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const id = (nextId.current += 1);
        setQueue((current) => [...current, { ...options, id, resolve }]);
      }),
    [],
  );
  const current = queue[0] ?? null;
  // Resolved here, not inside the state updater: StrictMode runs updaters
  // twice, and an updater must stay free of side effects.
  const answer = (value: boolean) => {
    if (!current) return;
    current.resolve(value);
    setQueue((pending) => pending.filter((item) => item.id !== current.id));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <ConfirmModal
          // Remount per pertanyaan: fokus awal dan status tombol selalu mulai
          // dari pertanyaan yang sedang ditampilkan.
          key={current.id}
          options={current}
          onAnswer={answer}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer(value: boolean): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const answered = useRef(false);
  const titleId = useId();
  const messageId = useId();
  const danger = options.tone === "danger";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom tidak mengimplementasikan showModal; di sana dialog dirender
    // terbuka lewat atribut `open` di bawah.
    if (!dialog.open && typeof dialog.showModal === "function")
      dialog.showModal();
    // Aksi berbahaya mulai dari "Kembali": Enter yang refleks tidak boleh
    // menghapus apa pun.
    (danger ? cancelRef : confirmRef).current?.focus();
  }, [danger]);

  const settle = (value: boolean) => {
    if (answered.current) return;
    answered.current = true;
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    onAnswer(value);
  };

  return (
    <dialog
      ref={dialogRef}
      open={typeof HTMLDialogElement.prototype.showModal !== "function"}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-md border border-border bg-surface p-0 text-foreground shadow-panel backdrop:bg-slate-950/45"
      // Escape memicu `cancel`: dijawab tidak, sama seperti tombol Kembali.
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
    >
      <div className="grid gap-3 p-4">
        <h2 id={titleId} className="text-base font-bold">
          {options.title}
        </h2>
        <div id={messageId} className="text-sm leading-6 text-muted">
          {options.message}
        </div>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="inline-flex min-h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => settle(false)}
          >
            {options.cancelLabel ?? "Kembali"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              danger
                ? "bg-danger hover:brightness-90"
                : "bg-brand hover:bg-brand-strong"
            }`}
            onClick={() => settle(true)}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
