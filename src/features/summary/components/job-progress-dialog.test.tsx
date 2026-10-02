import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JobProgressDialog,
  type JobProgressDialogProps,
} from "./job-progress-dialog";

const STEPS = [
  { label: "Kirim permintaan", hint: "a" },
  { label: "Antre di worker", hint: "b" },
  { label: "Tarik dari HRIS", hint: "c" },
  { label: "Siap dipakai", hint: "d" },
];

function props(
  overrides: Partial<JobProgressDialogProps>,
): JobProgressDialogProps {
  return {
    icon: "sync",
    titles: { running: "Berjalan", done: "Selesai", failed: "Gagal" },
    subtitle: "Periode",
    steps: STEPS,
    current: 0,
    status: "running",
    startedAt: Date.now(),
    doneMessage: "Beres",
    onDismiss: () => {},
    ...overrides,
  };
}

function activeStep() {
  return document
    .querySelector('li[aria-current="step"]')
    ?.querySelector(".job-progress-step-label")?.textContent;
}

/** Satu tahap per timer: React menjadwalkan timer berikutnya setelah render. */
function walk(steps: number) {
  for (let index = 0; index < steps; index += 1)
    act(() => void vi.advanceTimersByTime(600));
}

// jsdom tidak punya showModal, jadi isi dialog dibaca lewat DOM, bukan role.
const title = () => document.querySelector("h2")?.textContent;
const text = () => document.body.textContent ?? "";

describe("JobProgressDialog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maju satu tahap per satu walau status job melompat", () => {
    const { rerender } = render(<JobProgressDialog {...props({})} />);
    expect(activeStep()).toBe("Kirim permintaan");

    // Worker sudah mengambil tugas sebelum polling pertama.
    rerender(<JobProgressDialog {...props({ current: 2 })} />);
    expect(activeStep()).toBe("Kirim permintaan");
    act(() => void vi.advanceTimersByTime(600));
    expect(activeStep()).toBe("Antre di worker");
    act(() => void vi.advanceTimersByTime(600));
    expect(activeStep()).toBe("Tarik dari HRIS");
  });

  it("tidak mundur saat job kembali ke antrean untuk percobaan ulang", () => {
    const { rerender } = render(
      <JobProgressDialog {...props({ current: 2 })} />,
    );
    walk(3);
    expect(activeStep()).toBe("Tarik dari HRIS");

    rerender(<JobProgressDialog {...props({ current: 1 })} />);
    walk(3);
    expect(activeStep()).toBe("Tarik dari HRIS");
  });

  it("hasil akhir baru tampil setelah jejak sampai di tahap terakhir", () => {
    render(
      <JobProgressDialog
        {...props({
          current: 3,
          status: "done",
          result: [{ label: "Catatan attendance", value: "48" }],
        })}
      />,
    );
    expect(title()).toBe("Berjalan");
    expect(text()).not.toContain("Catatan attendance");

    walk(3);
    expect(title()).toBe("Selesai");
    expect(text()).toContain("Catatan attendance");
  });
});
