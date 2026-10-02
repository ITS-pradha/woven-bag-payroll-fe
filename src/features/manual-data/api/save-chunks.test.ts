import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client/api-client";
import {
  BatchResponseShapeError,
  PartialSaveError,
  saveChunks,
  saveProduction,
  saveProductionBatched,
  SAVE_BATCH_ROWS,
  type SaveAttempt,
} from "./manual-data-api";

const attempt = (count: number, key = "abc"): SaveAttempt => ({
  key,
  rows: Array.from({ length: count }, (_, index) => ({
    clientRowId: `row-${index}`,
    shiftStart: "2026-07-01T07:00:00+07:00",
    shiftEnd: "2026-07-01T15:00:00+07:00",
    stationNo: 1,
    pin: "7813",
    widthCm: "66",
    weftDensity: "10",
    resultMeter: "0",
  })),
});

describe("pemecahan batch simpan", () => {
  it("tidak memecah apa pun yang sudah muat", () => {
    const one = attempt(SAVE_BATCH_ROWS);
    // Identity, not a copy: a single-chunk save must keep the caller's own key
    // so the existing retry path is unchanged.
    expect(saveChunks(one)).toEqual([one]);
    expect(saveChunks(one)[0]?.key).toBe("abc");
  });

  it("memecah tepat di batas dan tidak kehilangan satu baris pun", () => {
    const big = attempt(15_141);
    const chunks = saveChunks(big);
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([
      5_000, 5_000, 5_000, 141,
    ]);
    // Every row exactly once, in the original order.
    expect(chunks.flatMap((chunk) => chunk.rows)).toEqual(big.rows);
    // Each chunk stays under the contract's 10.000-row ceiling.
    for (const chunk of chunks)
      expect(chunk.rows.length).toBeLessThanOrEqual(10_000);
  });

  it("menurunkan kunci dari attempt, jadi ulang-simpan memutar ulang alih-alih menulis dua kali", () => {
    const first = saveChunks(attempt(12_000, "attempt-1"));
    const retry = saveChunks(attempt(12_000, "attempt-1"));
    expect(retry.map((chunk) => chunk.key)).toEqual(
      first.map((chunk) => chunk.key),
    );
    // Unique within one save, so two chunks can never collide on one key.
    expect(new Set(first.map((chunk) => chunk.key)).size).toBe(first.length);
    // A different attempt gets different keys — a fresh save is a fresh write.
    expect(saveChunks(attempt(12_000, "attempt-2"))[0]?.key).not.toBe(
      first[0]?.key,
    );
  });

  it("memakai ukuran yang diminta, supaya batas kontrak bisa diuji", () => {
    expect(saveChunks(attempt(7), 3).map((chunk) => chunk.rows.length)).toEqual(
      [3, 3, 1],
    );
  });
});

/** Answers each POST with `answer(rows)`; a thrown value is a network failure. */
function stubPost(
  answer: (rows: { clientRowId: string }[], call: number) => unknown,
) {
  let call = 0;
  return vi.spyOn(apiClient, "POST").mockImplementation((async (
    _path: string,
    init: { body: { rows: { clientRowId: string }[] } },
  ) => {
    const data = answer(init.body.rows, call++);
    return { data, response: new Response(null, { status: 200 }) };
  }) as never);
}

const okBatch = (rows: { clientRowId: string }[], rowVersion: unknown = 1) => ({
  batchId: "00000000-0000-4000-8000-000000000001",
  sourceRevision: "1",
  counts: { inserted: rows.length, updated: 0, unchanged: 0, rejected: 0 },
  rows: rows.map((row) => ({
    clientRowId: row.clientRowId,
    outcome: "INSERTED",
    productionEntryId: "00000000-0000-4000-8000-000000000002",
    rowVersion,
  })),
});

describe("simpan berbatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("batch ke-2 gagal: PartialSaveError membawa hasil batch yang sudah tersimpan", async () => {
    const failure = new Error("jaringan putus");
    stubPost((rows, call) => {
      if (call === 1) throw failure;
      return okBatch(rows);
    });
    const error = await saveProductionBatched(
      attempt(SAVE_BATCH_ROWS + 10),
      "csrf",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialSaveError);
    const partial = error as PartialSaveError;
    expect(partial.failedChunkIndex).toBe(1);
    expect(partial.cause).toBe(failure);
    expect(partial.completed.counts.inserted).toBe(SAVE_BATCH_ROWS);
    expect(partial.completed.rows).toHaveLength(SAVE_BATCH_ROWS);
  });

  it("batch pertama gagal: error aslinya yang dilempar", async () => {
    const failure = new Error("server mati");
    stubPost(() => {
      throw failure;
    });
    await expect(
      saveProductionBatched(attempt(SAVE_BATCH_ROWS + 10), "csrf"),
    ).rejects.toBe(failure);
  });

  it("rowVersion string dikoersi; bentuk salah = BatchResponseShapeError", async () => {
    stubPost((rows) => okBatch(rows, "7"));
    const result = await saveProduction(attempt(1), "csrf");
    expect(result.rows[0]?.rowVersion).toBe(7);

    vi.restoreAllMocks();
    stubPost(() => ({ nope: true }));
    await expect(saveProduction(attempt(1), "csrf")).rejects.toBeInstanceOf(
      BatchResponseShapeError,
    );
  });
});
