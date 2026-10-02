import { describe, expect, it, vi } from "vitest";
import {
  ImportAborted,
  importProductionStream,
  rejectionReportCsv,
  type BatchResult,
} from "./import-stream";
import type { BatchInput } from "./rows";

const HEADER =
  "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]";

function line(station: number, day = 4, pin = "8954") {
  const date = `2026-09-${String(day).padStart(2, "0")}`;
  return `${date} 07:00,${date} 15:00,${station},${pin},56,10,982`;
}

/** Memotong teks kecil-kecil supaya batas potongan jatuh di tengah baris. */
async function* chunked(text: string, size = 7): AsyncIterable<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

function accepting(): {
  send: (rows: BatchInput[], key: string) => Promise<BatchResult>;
  calls: { rows: BatchInput[]; key: string }[];
} {
  const calls: { rows: BatchInput[]; key: string }[] = [];

  return {
    calls,
    send: async (rows, key) => {
      calls.push({ rows, key });
      return {
        counts: {
          inserted: rows.length,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        },
        rows: rows.map((row) => ({
          clientRowId: row.clientRowId,
          outcome: "INSERTED" as const,
        })),
      };
    },
  };
}

let keys = 0;
const newKey = () => `key-${++keys}`;

describe("importProductionStream", () => {
  it("mengirim file besar dalam beberapa batch tanpa menahan isinya", async () => {
    const rows = 5_000;
    const text = [
      HEADER,
      ...Array.from({ length: rows }, (_, i) => line(i + 1)),
    ].join("\n");
    const api = accepting();

    const summary = await importProductionStream({
      chunks: chunked(text, 64 * 1024),
      send: api.send,
      newKey,
      batchSize: 2_000,
    });

    expect(summary.rowsRead).toBe(rows);
    expect(summary.inserted).toBe(rows);
    expect(summary.rejected).toBe(0);
    expect(api.calls).toHaveLength(3);
    expect(api.calls.map((call) => call.rows.length)).toEqual([
      2000, 2000, 1000,
    ]);
    // Satu Idempotency-Key per batch: key yang sama dengan payload berbeda
    // dijawab 409 oleh backend.
    expect(new Set(api.calls.map((call) => call.key)).size).toBe(3);
  });

  it("menyusun ulang baris yang terpotong di tengah antar chunk stream", async () => {
    const api = accepting();

    const summary = await importProductionStream({
      chunks: chunked(`${HEADER}\r\n${line(51)}\r\n${line(52)}\r\n`, 5),
      send: api.send,
      newKey,
    });

    expect(summary.rowsRead).toBe(2);
    expect(api.calls[0]?.rows[1]).toMatchObject({ stationNo: 52, pin: "8954" });
  });

  it("melaporkan baris tidak valid tanpa mengirimnya", async () => {
    const api = accepting();

    const summary = await importProductionStream({
      chunks: chunked(
        [
          HEADER,
          line(51),
          "2026-09-04 07:00,2026-09-04 15:00,52,8954,0,10,982",
        ].join("\n"),
      ),
      send: api.send,
      newKey,
    });

    expect(summary.inserted).toBe(1);
    expect(summary.rejected).toBe(1);
    // Nomor baris mengikuti file, bukan batch: baris judul ikut dihitung.
    expect(summary.rejections[0]).toMatchObject({
      row: 3,
      field: "Width [cm]",
    });
    expect(api.calls[0]?.rows).toHaveLength(1);
  });

  it("menangkap duplikat kunci unik yang tersebar di batch berbeda", async () => {
    const api = accepting();
    const duplicate = line(51);

    const summary = await importProductionStream({
      chunks: chunked([HEADER, duplicate, line(52), duplicate].join("\n")),
      send: api.send,
      newKey,
      batchSize: 1,
    });

    expect(summary.rejected).toBe(1);
    expect(summary.rejections[0]?.message).toMatch(/Duplikat/);
    expect(summary.inserted).toBe(2);
    expect(summary.rowsSent).toBe(2);
  });

  it("meneruskan penolakan per baris dari server dengan nomor baris file", async () => {
    const summary = await importProductionStream({
      chunks: chunked([HEADER, line(51)].join("\n")),
      newKey,
      send: async (rows) => ({
        counts: {
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected: rows.length,
        },
        rows: rows.map((row) => ({
          clientRowId: row.clientRowId,
          outcome: "REJECTED" as const,
          fieldErrors: [
            {
              field: "pin",
              code: "PIN_NOT_FOUND",
              message: "PIN tidak dikenal.",
            },
          ],
        })),
      }),
    });

    expect(summary.rejected).toBe(1);
    expect(summary.rejections[0]).toMatchObject({
      row: 2,
      message: "PIN tidak dikenal.",
    });
  });

  it("melaporkan kemajuan per batch supaya UI tidak diam", async () => {
    const onProgress = vi.fn();
    const api = accepting();

    await importProductionStream({
      chunks: chunked([HEADER, line(51), line(52), line(53)].join("\n")),
      send: api.send,
      newKey,
      batchSize: 1,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({
      rowsSent: 3,
      batches: 3,
    });
  });

  it("berhenti saat dibatalkan dan tidak mengirim batch berikutnya", async () => {
    const controller = new AbortController();
    const api = accepting();

    const promise = importProductionStream({
      chunks: chunked([HEADER, line(51), line(52)].join("\n")),
      newKey,
      batchSize: 1,
      signal: controller.signal,
      send: async (rows, key) => {
        controller.abort();
        return api.send(rows, key);
      },
    });

    await expect(promise).rejects.toBeInstanceOf(ImportAborted);
    expect(api.calls).toHaveLength(1);
  });

  it("menerima file tanpa header dan tanpa newline penutup", async () => {
    const api = accepting();

    const summary = await importProductionStream({
      chunks: chunked(line(51), 3),
      send: api.send,
      newKey,
    });

    expect(summary.headerDetected).toBe(false);
    expect(summary.rowsRead).toBe(1);
  });

  it("tetap ringan untuk file 50 ribu baris", async () => {
    // Bukan benchmark presisi; yang dijaga adalah tidak ada langkah kuadratik
    // yang membuat file besar berhenti sama sekali.
    const rows = 50_000;
    const text = [
      HEADER,
      ...Array.from({ length: rows }, (_, i) =>
        line((i % 900) + 1, (i % 28) + 1),
      ),
    ].join("\n");
    const api = accepting();
    const started = Date.now();

    const summary = await importProductionStream({
      chunks: chunked(text, 256 * 1024),
      send: api.send,
      newKey,
      batchSize: 5_000,
    });

    expect(summary.rowsRead).toBe(rows);
    expect(summary.rowsSent + summary.rejected).toBe(rows);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("menghitung baris ditolak, bukan jumlah pesan", async () => {
    const bad = "2026-09-04 07:00,2026-09-04 15:00,51,8954,,,";
    const summary = await importProductionStream({
      chunks: chunked([HEADER, bad, line(52)].join("\n")),
      send: accepting().send,
      newKey,
    });
    expect(summary.rejections).toHaveLength(3);
    expect(summary.rejected).toBe(1);
    expect(summary.inserted).toBe(1);
  });

  it("baris judul di bawah judul laporan, nomor baris file tetap", async () => {
    const api = accepting();
    const summary = await importProductionStream({
      chunks: chunked(
        [
          "Laporan Produksi",
          "",
          HEADER,
          line(51),
          "",
          "x,y,52,8954,56,10,1",
        ].join("\n"),
      ),
      send: api.send,
      newKey,
    });
    expect(summary.headerDetected).toBe(true);
    expect(summary.skippedBeforeHeader).toBe(1);
    expect(summary.inserted).toBe(1);
    expect(new Set(summary.rejections.map((item) => item.row))).toEqual(
      new Set([6]),
    );
  });

  it("kolom lebih tanpa header ditolak per baris, impor jalan terus", async () => {
    const api = accepting();
    const summary = await importProductionStream({
      chunks: chunked([`${line(51)},asing`, `${line(52)},,`].join("\n")),
      send: api.send,
      newKey,
    });
    expect(summary.rejected).toBe(1);
    expect(summary.rejections[0]).toMatchObject({ row: 1, field: "Baris" });
    expect(api.calls.flatMap((call) => call.rows)).toHaveLength(1);
  });

  it("importKey: kunci batch turunan, sama persis saat diulang", async () => {
    const text = [
      HEADER,
      ...Array.from({ length: 5 }, (_, i) => line(i + 1)),
    ].join("\n");
    const run = async () => {
      const api = accepting();
      await importProductionStream({
        chunks: chunked(text),
        send: api.send,
        importKey: "imp-1",
        batchSize: 2,
      });
      return api.calls.map((call) => call.key);
    };
    const first = await run();
    expect(first).toEqual(["imp-1-0", "imp-1-1", "imp-1-2"]);
    expect(await run()).toEqual(first);
  });

  it("baris gagal tidak membuat baris benar dengan shift sama jadi duplikat", async () => {
    const failing = "2026-09-04 07:00,2026-09-04 15:00,51,,56,10,982";
    const summary = await importProductionStream({
      chunks: chunked([HEADER, failing, line(51)].join("\n")),
      send: accepting().send,
      newKey,
    });
    expect(summary.rejected).toBe(1);
    expect(summary.inserted).toBe(1);
  });

  it("menolak file kosong", async () => {
    await expect(
      importProductionStream({
        chunks: chunked("   "),
        send: accepting().send,
        newKey,
      }),
    ).rejects.toThrow(/kosong/);
  });

  it("menulis laporan penolakan sebagai CSV yang bisa dibuka lagi", () => {
    const csv = rejectionReportCsv([
      {
        row: 12,
        field: "Width [cm]",
        value: "0",
        message: 'Isi angka, "titik"',
      },
    ]);

    expect(csv.split("\n")[0]).toBe("Baris file,Kolom,Nilai,Alasan");
    expect(csv).toContain('"Isi angka, ""titik"""');
  });
});
