import type { CSSProperties, ReactNode } from "react";

import "./skeleton.css";

/**
 * Loading sebagai bentuk layar yang akan muncul, satu bahasa untuk semua menu.
 *
 * - Semua bentuk berbagi SATU kilau (`background-attachment: fixed`), jadi
 *   bar di tabel, kartu metrik, dan panel bergerak sebagai satu sapuan.
 * - Kerangka mengikuti tata letak aslinya, supaya data menggantikannya di
 *   tempat tanpa layar melompat.
 * - Keterangan apa yang sedang dimuat selalu berupa teks sungguhan
 *   (`role="status"`), bukan hanya `aria-label` pada kotak abu-abu.
 */
export function Bone({
  width,
  height,
  className = "",
  style,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-bone ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

/** Kartu kecil "sedang memuat …" yang mengambang di atas kerangka. */
export function LoadingCaption({ label }: { label: string }) {
  return (
    <div className="skeleton-caption" role="status" aria-live="polite">
      <span className="skeleton-caption-label">{label}…</span>
      <span className="skeleton-caption-track" aria-hidden="true" />
    </div>
  );
}

/** Lebar isian bergiliran supaya kerangka terbaca sebagai data, bukan pola. */
const FILL = [72, 54, 86, 63, 78, 48, 90, 58];

/**
 * Kerangka tabel. `columns` adalah proporsi lebar kolom (fr) yang sama dengan
 * tabel aslinya; `align` "end" untuk kolom angka yang rata kanan.
 */
export function TableSkeleton({
  label,
  columns,
  align = [],
  rows = 12,
  className = "",
  height,
}: {
  label?: string;
  columns: number[];
  align?: ("start" | "end" | "center")[];
  rows?: number;
  className?: string;
  /** Tinggi kotak; baris yang tidak muat terpotong dan memudar. */
  height?: string;
}) {
  const template = columns.map((fr) => `${fr}fr`).join(" ");
  return (
    <div
      className={`skeleton-surface skeleton-table ${className}`}
      aria-busy="true"
      style={height ? { height } : undefined}
    >
      <div className="skeleton-table-body" aria-hidden="true">
        <div
          className="skeleton-row skeleton-row-head"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((_, column) => (
            <span key={column} className={cellClass(align[column])}>
              <Bone width="52%" />
            </span>
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div
            key={row}
            className="skeleton-row"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((_, column) => (
              <span key={column} className={cellClass(align[column])}>
                <Bone width={`${FILL[(row * 3 + column) % FILL.length]}%`} />
              </span>
            ))}
          </div>
        ))}
      </div>
      {label ? <LoadingCaption label={label} /> : null}
    </div>
  );
}

function cellClass(align: "start" | "end" | "center" | undefined) {
  return `skeleton-cell${align === "end" ? " skeleton-cell-end" : align === "center" ? " skeleton-cell-center" : ""}`;
}

/** Deretan kartu angka, mis. metrik Summary. */
export function MetricsSkeleton({ count }: { count: number }) {
  return (
    <div
      aria-hidden="true"
      className="skeleton-surface skeleton-metrics"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(9rem, 1fr))` }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-metric">
          <Bone width="45%" height="0.4375rem" />
          <Bone width="70%" height="0.875rem" />
        </div>
      ))}
    </div>
  );
}

/** Bilah pemilih (label + dropdown [+ keterangan]), mis. histori payroll. */
export function SelectorSkeleton({
  label,
  trailing = true,
}: {
  label: string;
  trailing?: boolean;
}) {
  return (
    <div className="skeleton-surface skeleton-selector" aria-busy="true">
      <div className="skeleton-selector-field" aria-hidden="true">
        <Bone width="5.5rem" height="0.4375rem" />
        <Bone width="100%" height="2rem" className="skeleton-bone-field" />
      </div>
      {trailing ? <Bone width="9rem" height="0.5rem" /> : null}
      <span className="skeleton-sr" role="status">
        {label}
      </span>
    </div>
  );
}

/** Panel generik: judul, beberapa baris isi, dan satu tombol. */
export function PanelSkeleton({
  label,
  lines = 4,
  children,
  className = "",
}: {
  label?: string;
  lines?: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-surface skeleton-panel ${className}`}
      aria-busy="true"
    >
      <div aria-hidden="true" className="skeleton-panel-body">
        <Bone width="11rem" height="0.625rem" />
        {Array.from({ length: lines }, (_, index) => (
          <Bone
            key={index}
            width={`${FILL[index % FILL.length]}%`}
            height="0.5rem"
          />
        ))}
        {children}
      </div>
      {label ? <LoadingCaption label={label} /> : null}
    </div>
  );
}
