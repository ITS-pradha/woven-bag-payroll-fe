import type { CSSProperties, ReactNode } from "react";

import "./empty-state.css";

export type EmptyStateIcon =
  "book" | "payroll" | "rates" | "stations" | "person";

/**
 * Keadaan kosong, satu bahasa untuk semua menu.
 *
 * - Satu kartu di tengah: judul, satu kalimat alasan, dan paling banyak SATU
 *   tindakan — langkah berikutnya, bukan daftar pilihan.
 * - Di belakangnya `backdrop`: sketsa samar layar yang nanti terisi, disusun
 *   tiap fitur dari `GhostTable`/`GhostBar` — spreadsheet untuk Manual Data,
 *   matriks harga untuk Konfigurasi Harga, dan seterusnya. Layar kosong jadi
 *   terbaca "di sinilah datanya nanti", dalam bentuk datanya sendiri. Statis:
 *   tidak ada yang sedang dimuat, jadi tidak ada kilau seperti skeleton.
 * - Bukan `role="alert"`: kosong bukan error, dan pembaca layar tidak perlu
 *   diinterupsi. Judulnya h2 yang menamai section.
 */
export function EmptyState({
  id,
  icon,
  title,
  description,
  action,
  backdrop,
  fill = false,
}: {
  /** Dipakai untuk `aria-labelledby`; harus unik di halaman. */
  id: string;
  icon: EmptyStateIcon;
  title: string;
  description: ReactNode;
  /** Tombol atau tautan langkah berikutnya, atau catatan bila tak berizin. */
  action?: ReactNode;
  /** Sketsa layar fitur ini; lihat `GhostTable` dan `GhostBar`. */
  backdrop: ReactNode;
  /** Mengisi sisa tinggi layar (halaman yang isinya hanya keadaan ini). */
  fill?: boolean;
}) {
  return (
    <section
      className={`empty-state${fill ? " empty-state-fill" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="empty-state-sheet" aria-hidden="true">
        {backdrop}
      </div>
      <div className="empty-state-card">
        <Icon name={icon} />
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
        {action ? <div className="empty-state-action">{action}</div> : null}
      </div>
    </section>
  );
}

/** Lebar isian bergiliran supaya sketsa terbaca sebagai data, bukan pola. */
const FILL = [62, 44, 78, 52, 70, 38, 84, 56];

/**
 * Tabel samar: pita header lalu baris bergaris. `columns` adalah proporsi
 * kolom (fr) yang sama dengan tabel aslinya. `head` mengisi header dengan
 * teks samar (huruf kolom, anyaman), `gutter` menomori baris seperti
 * spreadsheet, dan `filled` memberi sel balok isian.
 */
export function GhostTable({
  columns,
  rows = 16,
  head,
  gutter = false,
  filled = false,
  className = "",
}: {
  columns: number[];
  rows?: number;
  head?: readonly string[];
  gutter?: boolean;
  filled?: boolean;
  className?: string;
}) {
  const template = `${gutter ? "2.5rem " : ""}${columns.map((fr) => `${fr}fr`).join(" ")}`;
  return (
    <div className={`ghost-table ${className}`}>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className={`ghost-row${row === 0 ? " ghost-head" : ""}`}
          style={{ gridTemplateColumns: template }}
        >
          {gutter ? (
            <span className="ghost-gutter" data-label={row === 0 ? "" : row} />
          ) : null}
          {columns.map((_, column) => (
            <span key={column} className="ghost-cell">
              {row === 0 && head?.[column] ? (
                <GhostLabel text={head[column]} />
              ) : filled && row > 0 ? (
                <GhostBar
                  width={`${FILL[(row * 3 + column) % FILL.length]}%`}
                />
              ) : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Teks samar di sketsa (judul kolom, nama metrik). Digambar lewat CSS
 * `content: attr(data-label)`, bukan sebagai teks: sketsa hanya bentuk, dan
 * teks sungguhan sepucat ini gagal cek kontras walau `aria-hidden`.
 */
export function GhostLabel({ text }: { text: string }) {
  return <span className="ghost-label" data-label={text} />;
}

/** Satu balok isian samar. */
export function GhostBar({
  width,
  height,
  className = "",
  style,
}: {
  width?: string;
  height?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`ghost-bar ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

const PATHS: Record<EmptyStateIcon, ReactNode> = {
  // Buku terbuka.
  book: (
    <>
      <path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.75v13c3.6-.15 6.2.45 8 1.75 1.8-1.3 4.4-1.9 8-1.75v-13c-3.6-.15-6.2.45-8 1.75Z" />
      <path d="M12 6.5v13M7 8.5h2.5M7 11.5h2.5M14.5 8.5H17M14.5 11.5H17" />
    </>
  ),
  // Slip gaji: lembar dengan baris nominal.
  payroll: (
    <>
      <path d="M6 3.5h9l3 3v14H6z" />
      <path d="M15 3.5v3h3M9 10h6M9 13.5h6M9 17h3.5" />
    </>
  ),
  // Label harga.
  rates: (
    <>
      <path d="M3.75 12.4V4.75a1 1 0 0 1 1-1h7.65l7.85 7.85a1 1 0 0 1 0 1.4l-7.25 7.25a1 1 0 0 1-1.4 0z" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </>
  ),
  // Deretan mesin dalam kelompok.
  stations: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1" />
      <rect x="13.5" y="4" width="7" height="7" rx="1" />
      <rect x="3.5" y="14" width="7" height="6" rx="1" />
      <path d="M13.5 17h7" />
    </>
  ),
  // Orang: memilih karyawan.
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" />
    </>
  ),
};

function Icon({ name }: { name: EmptyStateIcon }) {
  return (
    <svg
      className="empty-state-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
