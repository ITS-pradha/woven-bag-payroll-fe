import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../../api/client/api-result";
import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("memvalidasi PIN dan password sebelum mengirim request", async () => {
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn();

    render(
      <LoginForm onPasswordLogin={onPasswordLogin} onSsoLogin={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(await screen.findByText("PIN wajib diisi.")).toBeInTheDocument();
    expect(screen.getByText("Password wajib diisi.")).toBeInTheDocument();
    expect(onPasswordLogin).not.toHaveBeenCalled();
  });

  it("mengirim kredensial dan pilihan ingat perangkat", async () => {
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn().mockResolvedValue(undefined);

    render(
      <LoginForm onPasswordLogin={onPasswordLogin} onSsoLogin={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("PIN karyawan"), "PT1-0153-4600");
    await user.type(screen.getByLabelText("Password"), "password-ku");
    await user.click(
      screen.getByRole("checkbox", { name: "Ingat saya di perangkat ini" }),
    );
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(onPasswordLogin).toHaveBeenCalledWith({
      pin: "PT1-0153-4600",
      password: "password-ku",
      rememberMe: true,
    });
  });

  it("dapat menampilkan password tanpa mengubah nilainya", async () => {
    const user = userEvent.setup();

    render(<LoginForm onPasswordLogin={vi.fn()} onSsoLogin={vi.fn()} />);

    const password = screen.getByLabelText("Password");
    await user.type(password, "password-ku");
    await user.click(
      screen.getByRole("button", { name: "Tampilkan password" }),
    );

    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("password-ku");
    expect(
      screen.getByRole("button", { name: "Sembunyikan password" }),
    ).toBeInTheDocument();
  });

  it("menjalankan SSO tanpa meminta PIN dan password", async () => {
    const user = userEvent.setup();
    const onSsoLogin = vi.fn();

    render(<LoginForm onPasswordLogin={vi.fn()} onSsoLogin={onSsoLogin} />);

    await user.click(
      screen.getByRole("button", { name: "Masuk dengan SSO Portal" }),
    );

    // Tanpa argumen: SSO kini perjalanan halaman penuh ke Portal, bukan panggilan
    // API yang membawa pilihan "ingat saya".
    expect(onSsoLogin).toHaveBeenCalledWith();
  });

  it("menampilkan sebab kegagalan yang dikirim balik dari Portal", () => {
    render(
      <LoginForm
        onPasswordLogin={vi.fn()}
        onSsoLogin={vi.fn()}
        ssoError="Akun Anda belum diberi akses ke aplikasi ini di Portal."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Akun Anda belum diberi akses ke aplikasi ini di Portal.",
    );
  });

  it("menampilkan error backend dan mempertahankan input PIN", async () => {
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn().mockRejectedValue(
      new ApiClientError({
        status: 401,
        payload: {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email/Pin atau password salah",
            requestId: "req-login-1",
          },
        },
      }),
    );

    render(
      <LoginForm onPasswordLogin={onPasswordLogin} onSsoLogin={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("PIN karyawan"), "1027");
    await user.type(screen.getByLabelText("Password"), "salah");
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email/Pin atau password salah",
    );
    expect(screen.getByLabelText("PIN karyawan")).toHaveValue("1027");
  });
});
