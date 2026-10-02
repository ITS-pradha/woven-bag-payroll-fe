import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "./toast";
import { useToast, type ToastOptions } from "./use-toast";

function Trigger({ options }: { options: ToastOptions }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      kirim
    </button>
  );
}

function setup(options: ToastOptions) {
  render(
    <ToastProvider>
      <Trigger options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "kirim" }));
}

describe("toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mengumumkan pesan sukses lalu hilang sendiri", () => {
    setup({
      title: "Buku KARUNG-2026-09 diperbarui",
      message: "Rentang 24 Agu – 23 Sep 2026.",
    });
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Buku KARUNG-2026-09 diperbarui");

    act(() => void vi.advanceTimersByTime(5_100));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("berhenti menghitung selama kursor di atasnya", () => {
    setup({ message: "Buku dibuat." });
    const toast = screen.getByRole("status");
    act(() => void vi.advanceTimersByTime(4_000));
    fireEvent.pointerEnter(toast);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status")).toBeTruthy();

    fireEvent.pointerLeave(toast);
    act(() => void vi.advanceTimersByTime(900));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("error memakai role alert dan bisa ditutup manual", () => {
    setup({ tone: "error", message: "Gagal menyimpan." });
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal menyimpan.");
    fireEvent.click(screen.getByRole("button", { name: "Tutup notifikasi" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
