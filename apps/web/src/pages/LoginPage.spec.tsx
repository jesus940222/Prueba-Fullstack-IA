import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LoginPage } from "./LoginPage";

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("login", () => {
  it("asks for a valid email and then for the local mailbox code", async () => {
    const user = userEvent.setup();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ nextStep: "EMAIL_CHALLENGE", challengeId: "00000000-0000-4000-8000-000000000099" }),
    }));
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Escribe un correo válido")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Correo"), "ana@portal.local");
    await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByLabelText("Código")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuar con Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuar con Microsoft" })).not.toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("offers the passkey ceremony when the service asks for it", async () => {
    const user = userEvent.setup();
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ nextStep: "PASSKEY_CHALLENGE", challengeId: "00000000-0000-4000-8000-000000000099" }) })) as unknown as typeof fetch;
    renderLogin();
    await user.type(screen.getByLabelText("Correo"), "ana@portal.local");
    await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("button", { name: "Usar passkey" })).toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("explains when the passkey challenge cannot be prepared", async () => {
    const user = userEvent.setup();
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/passkey/options")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ nextStep: "PASSKEY_CHALLENGE", challengeId: "00000000-0000-4000-8000-000000000099" }) };
    }) as unknown as typeof fetch;
    renderLogin();
    await user.type(screen.getByLabelText("Correo"), "ana@portal.local");
    await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Usar passkey" }));
    expect(await screen.findByText("No se pudo preparar la passkey.")).toBeInTheDocument();
    globalThis.fetch = original;
  });
});
