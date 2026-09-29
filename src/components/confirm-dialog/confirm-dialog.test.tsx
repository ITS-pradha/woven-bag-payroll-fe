import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConfirmProvider } from "./confirm-dialog";
import { useConfirm, type ConfirmOptions } from "./use-confirm";

function Asker({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer(value: boolean): void;
}) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm(options).then(onAnswer)}>
      tanya
    </button>
  );
}

const deleteRows: ConfirmOptions = {
  title: "Hapus 12 baris?",
  message: "Baris dihapus dari sheet.",
  confirmLabel: "Hapus 12 baris",
  tone: "danger",
};

function setup(options = deleteRows) {
  const answers: boolean[] = [];
  render(
    <ConfirmProvider>
      <Asker options={options} onAnswer={(value) => answers.push(value)} />
    </ConfirmProvider>,
  );
  return answers;
}

describe("ConfirmProvider", () => {
  it("menjawab ya lewat tombol aksi, dan menutup dialognya", async () => {
    const answers = setup();
    await userEvent.click(screen.getByRole("button", { name: "tanya" }));

    const dialog = screen.getByRole("dialog", { name: "Hapus 12 baris?" });
    expect(dialog).toHaveAccessibleDescription("Baris dihapus dari sheet.");
    await userEvent.click(
      screen.getByRole("button", { name: "Hapus 12 baris" }),
    );

    expect(answers).toEqual([true]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aksi berbahaya mulai dengan fokus di Kembali, dan Kembali menjawab tidak", async () => {
    const answers = setup();
    await userEvent.click(screen.getByRole("button", { name: "tanya" }));

    const back = screen.getByRole("button", { name: "Kembali" });
    expect(back).toHaveFocus();
    await userEvent.click(back);
    expect(answers).toEqual([false]);
  });

  it("Escape menjawab tidak", async () => {
    const answers = setup();
    await userEvent.click(screen.getByRole("button", { name: "tanya" }));

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    await waitFor(() => expect(answers).toEqual([false]));
  });

  it("dua pertanyaan bersamaan dijawab bergiliran, tidak saling menimpa", async () => {
    const answers = setup({ ...deleteRows, tone: "primary" });
    const ask = screen.getByRole("button", { name: "tanya" });
    await userEvent.click(ask);
    // Klik kedua lewat fireEvent: dialog modal pertama sedang terbuka.
    fireEvent.click(ask);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", { name: "Hapus 12 baris" }),
    );
    expect(answers).toEqual([true]);

    await userEvent.click(screen.getByRole("button", { name: "Kembali" }));
    expect(answers).toEqual([true, false]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dipakai di luar provider melempar, bukan jatuh ke window.confirm", () => {
    expect(() =>
      render(<Asker options={deleteRows} onAnswer={() => {}} />),
    ).toThrow(/ConfirmProvider/);
  });
});
