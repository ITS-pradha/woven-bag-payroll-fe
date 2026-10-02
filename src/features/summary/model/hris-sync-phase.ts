/** Tahap pop-up "Tarik dari HRIS", berurutan. */
export type HrisSyncPhase = "request" | "queued" | "syncing" | "done";

export const HRIS_SYNC_PHASES: readonly HrisSyncPhase[] = [
  "request",
  "queued",
  "syncing",
  "done",
];
