import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AccountsPage } from "./AccountsPage";
import { AccountDetailPage } from "./AccountDetailPage";
import { BeneficiariesPage } from "./BeneficiariesPage";
import { HomePage } from "./HomePage";
import { LimitsPage } from "./LimitsPage";
import { MovementsPage } from "./MovementsPage";
import { TransferPage } from "./TransferPage";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const beneficiaryId = "00000000-0000-4000-8000-0000000000b1";
const proposalId = "00000000-0000-4000-8000-000000000010";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function renderAt(path: string, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/cuentas" element={element} />
            <Route path="/cuentas/:accountId" element={element} />
            <Route path="/cuentas/:accountId/movimientos" element={element} />
            <Route path="/" element={element} />
            <Route path="/beneficiarios" element={element} />
            <Route path="/limites" element={element} />
            <Route path="/transferencias" element={element} />
            <Route path="/transferencias/propuestas/:proposalId" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("account screens", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows an empty page and a forbidden account list", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], totalItems: 0, page: 9, totalPages: 0 }) } as Response);
    renderAt("/cuentas?page=9", <AccountsPage />);
    expect(await screen.findByText("No hay cuentas en esta página.")).toBeInTheDocument();
  });

  it("does not query a malformed movement url", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    renderAt("/cuentas/no-es-uuid/movimientos?page=1", <MovementsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La dirección no es válida");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the balance untouched when confirmation is uncertain", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/transfer-proposals/")) {
        if (url.endsWith("/confirm")) {
          throw new Error("network_down");
        }
        return { ok: true, status: 200, json: async () => ({ id: "00000000-0000-4000-8000-000000000010", status: "pending", amount: "10.00", concept: "Renta", destinationLabel: "Bruno S.", expiresAt: "2026-10-22T18:05:00.000Z" }) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });
    const view = renderAt("/transferencias/propuestas/00000000-0000-4000-8000-000000000010", <TransferPage />);
    expect(await screen.findByText("Importe $10.00 MXN")).toBeInTheDocument();
    view.client.setQueryData(["accounts", "summary"], { totalBalance: "100.00", spendTotal: "0.00" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar transferencia" }));
    expect((await screen.findAllByText(/No se conoce el resultado/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Comprobante" })).not.toBeInTheDocument();
    expect(view.client.getQueryData(["accounts", "summary"])).toEqual({ totalBalance: "100.00", spendTotal: "0.00" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows the summary, a forbidden list and a movement history", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/summary")) {
        return jsonResponse(200, { totalBalance: "24850.00", spendTotal: "150.00", recentMovements: [{ id: "m1", direction: "out", amount: "150.00", recordedAt: "2026-02-02T18:00:00.000Z" }] });
      }
      if (url.includes("/movements")) {
        return jsonResponse(200, { items: [{ id: "m1", direction: "in", amount: "25000.00", recordedAt: "2026-01-15T16:00:00.000Z" }], totalItems: 1 });
      }
      if (url.includes("page=1")) {
        return jsonResponse(403, {});
      }
      return jsonResponse(200, { items: [], totalItems: 0, page: 1, totalPages: 0 });
    });
    renderAt("/", <HomePage />);
    expect(await screen.findByText(/Saldo disponible/)).toHaveTextContent("$24,850.00");
    expect(screen.getByText(/Gasto comercial de hoy/)).toHaveTextContent("$150.00");
    expect(screen.getByText(/Salida/)).toBeInTheDocument();
    renderAt("/cuentas?page=0", <AccountsPage />);
    expect(await screen.findByText("Los filtros de la dirección no son válidos.")).toBeInTheDocument();
    renderAt("/cuentas", <AccountsPage />);
    expect(await screen.findByText("No tienes permiso para ver cuentas.")).toBeInTheDocument();
    renderAt(`/cuentas/${accountId}/movimientos?direction=in`, <MovementsPage />);
    expect(await screen.findByText(/Entrada/)).toBeInTheDocument();
  });

  it("pages beneficiaries and rejects an out-of-range limit", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        return jsonResponse(204, {});
      }
      if (init?.method === "POST") {
        return jsonResponse(422, {});
      }
      if (url.includes("cursor=next")) {
        return jsonResponse(200, { items: [{ id: "00000000-0000-4000-8000-0000000000b2", alias: "Elena", destinationAccountId: accountId }], nextCursor: null, hasMore: false });
      }
      if (url.includes("search=")) {
        return jsonResponse(403, {});
      }
      return jsonResponse(200, { items: [{ id: beneficiaryId, alias: "Bruno", destinationAccountId: accountId }], nextCursor: "next", hasMore: true });
    });
    renderAt("/beneficiarios", <BeneficiariesPage />);
    expect(await screen.findByText("Bruno")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Elena")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de Bruno" }));
    await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
    await user.type(screen.getByLabelText("Alias"), "Nuevo");
    await user.type(screen.getByLabelText("Cuenta destino"), accountId);
    await user.click(screen.getByRole("button", { name: "Guardar beneficiario" }));
    expect((await screen.findAllByText("No se pudo guardar el beneficiario")).length).toBeGreaterThan(0);
    await user.clear(screen.getByLabelText("Cuenta destino"));
    await user.type(screen.getByLabelText("Cuenta destino"), "1000000000000003");
    await user.click(screen.getByRole("button", { name: "Guardar beneficiario" }));
    expect((await screen.findAllByText("No se pudo validar la cuenta destino")).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("Buscar"), "x");
    expect(await screen.findByText("No tienes permiso para ver beneficiarios.")).toBeInTheDocument();
  });

  it("saves limits only when the service accepts them", async () => {
    const user = userEvent.setup();
    let patch = 0;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        patch += 1;
        return jsonResponse(patch === 1 ? 422 : 200, {});
      }
      return jsonResponse(200, { perTransferLimit: "1000.00", dailyLimit: "5000.00", perTransferMax: "50000.00", dailyMax: "100000.00" });
    });
    renderAt("/limites", <LimitsPage />);
    expect(await screen.findByText(/Máximo por transferencia/)).toHaveTextContent("$50,000.00");
    expect(await screen.findByDisplayValue("1000.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar límites" }));
    expect(await screen.findByText(/fuera del máximo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar límites" }));
    expect(await screen.findByText("Límites actualizados.")).toBeInTheDocument();
  });

  it("prepares a proposal and recovers a completed transfer without a new key", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (headers.get("Idempotency-Key")) {
        keys.push(headers.get("Idempotency-Key") ?? "");
      }
      if (url.includes("/accounts?")) {
        return jsonResponse(200, { items: [{ id: accountId, name: "Nómina", balance: "100.00" }] });
      }
      if (url.includes("/recipients/resolve")) {
        return jsonResponse(200, {
          destinationAccountId: "00000000-0000-4000-8000-0000000000d1",
          accountNumberMasked: "************0004",
          holderLabel: "Bruno S.",
        });
      }
      if (url.includes("/beneficiaries")) {
        return jsonResponse(500, {});
      }
      if (url.endsWith("/transfer-proposals") && init?.method === "POST") {
        return jsonResponse(201, { id: proposalId });
      }
      if (url.endsWith("/confirm")) {
        return jsonResponse(0, null);
      }
      if (url.includes("/transfers?")) {
        return jsonResponse(200, { items: [{ id: "00000000-0000-4000-8000-0000000000t1", proposalId, reference: "TRF1", status: "completed", amount: "10.00" }] });
      }
      if (url.includes("/transfer-proposals/")) {
        return jsonResponse(200, { id: proposalId, status: "pending", amount: "10.00", concept: "Renta", destinationLabel: "Bruno S.", expiresAt: "2026-10-22T18:05:00.000Z" });
      }
      return jsonResponse(200, {});
    });
    renderAt("/transferencias", <TransferPage />);
    expect(await screen.findByRole("option", { name: /Nómina/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Cuenta origen"), accountId);
    await user.type(screen.getByLabelText("Cuenta ocasional"), "1000000000000004");
    await user.type(screen.getByLabelText("Importe MXN"), "10.00");
    await user.type(screen.getByLabelText("Concepto"), "Renta");
    await user.click(screen.getByRole("button", { name: "Revisar transferencia" }));
    expect(await screen.findByText("Importe $10.00 MXN")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar transferencia" }));
    expect((await screen.findAllByText(/No se conoce el resultado/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Comprobar estado" }));
    expect(await screen.findByRole("heading", { name: "Comprobante" })).toBeInTheDocument();
    expect(keys).toHaveLength(1);
  });

  it("shows each account balance apart from the total and a validated recipient", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/summary")) {
        return jsonResponse(200, {
          totalBalance: "30000.00",
          recentMovements: [
            { id: "m-in", direction: "in", amount: "10.00", recordedAt: "2026-01-15T16:00:00.000Z", balanceAfter: "10.00" },
            { id: "m-out", direction: "other", amount: "2.00", recordedAt: "2026-01-16T16:00:00.000Z" },
          ],
        });
      }
      if (url.includes("/me/offers")) {
        return jsonResponse(200, { items: [{ id: "o1", title: "Fondo", code: "fondo" }] });
      }
      if (url.endsWith("/me")) {
        return jsonResponse(200, { givenName: "Ana" });
      }
      if (url.includes("/accounts?")) {
        return jsonResponse(200, {
          items: [
            { id: accountId, name: "Nómina", accountNumber: "1000000000000001", currency: "MXN", balance: "20000.00", status: "active" },
            { id: "00000000-0000-4000-8000-0000000000a2", name: "Ahorro", balance: "10000.00", status: "closed" },
          ],
          totalItems: 2,
          page: 1,
          totalPages: 2,
        });
      }
      if (url.includes("/recipients/resolve") && init?.method === "POST") {
        return jsonResponse(404, {});
      }
      return jsonResponse(500, {});
    });
    renderAt("/", <HomePage />);
    expect(await screen.findByText(/Saldo total de tus cuentas/)).toBeInTheDocument();
    expect(screen.getByText(/Saldo disponible/)).toHaveTextContent("$30,000.00");
    expect(screen.getByText("Hola, Ana.")).toBeInTheDocument();
    expect(screen.getByText(/Fondo/)).toBeInTheDocument();
    expect(screen.getByText(/Número no incluido/)).toBeInTheDocument();
    cleanup();
    renderAt("/cuentas?page=1", <AccountsPage />);
    expect(await screen.findByRole("link", { name: "Nómina" })).toBeInTheDocument();
    expect(screen.getByText("Cerrada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    cleanup();
    renderAt("/transferencias", <TransferPage />);
    await user.click(await screen.findByRole("button", { name: "Validar destinatario" }));
    expect(await screen.findByText("Escribe la cuenta interna antes de validar.")).toBeInTheDocument();
  });

  it("shows an account, its movement detail and a failed recipient check", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/movements")) {
        return jsonResponse(200, {
          items: [
            { id: "00000000-0000-4000-8000-0000000000a9", direction: "out", amount: "150.00", recordedAt: "2026-02-02T18:00:00.000Z", balanceAfter: "24850.00", transferId: "00000000-0000-4000-8000-0000000000b9" },
            { id: "00000000-0000-4000-8000-0000000000aa", direction: "in", amount: "1.00", recordedAt: "2026-02-03T18:00:00.000Z" },
          ],
          totalItems: 2,
          page: 1,
          totalPages: 1,
        });
      }
      if (url.includes("/transfers/")) {
        return jsonResponse(200, { id: "00000000-0000-4000-8000-0000000000b9", reference: "TRF1", concept: "Compra", amount: "150.00", destinationLabel: "Tienda", completedAt: "2026-02-02T18:00:00.000Z", status: "completed" });
      }
      if (url.includes("00000000-0000-4000-8000-000000000404")) {
        return jsonResponse(404, {});
      }
      if (url.includes("/beneficiaries")) {
        return jsonResponse(200, { items: [] });
      }
      if (url.includes("/accounts?")) {
        return jsonResponse(200, { items: [{ id: accountId, name: "Nómina", balance: "24850.00" }] });
      }
      if (url.includes("/accounts/")) {
        return jsonResponse(200, { id: accountId, name: "Nómina", accountNumber: "1000000000000001", currency: "MXN", balance: "24850.00", status: "active" });
      }
      if (url.includes("/recipients/resolve")) {
        return jsonResponse(404, {});
      }
      if (url.includes("/accounts?")) {
        return jsonResponse(200, { items: [{ id: accountId, name: "Nómina", balance: "24850.00" }] });
      }
      if (url.includes("/beneficiaries")) {
        return jsonResponse(200, { items: [] });
      }
      if (init?.method === "POST") {
        return jsonResponse(422, {});
      }
      return jsonResponse(200, { items: [] });
    });
    renderAt(`/cuentas/${accountId}`, <AccountDetailPage />);
    expect(await screen.findByText(/Saldo de la cuenta/)).toBeInTheDocument();
    expect(await screen.findByText(/Saldo posterior/)).toBeInTheDocument();
    cleanup();
    renderAt("/cuentas/no-es-uuid", <AccountDetailPage />);
    expect(await screen.findByText(/No se consultó la cuenta/)).toBeInTheDocument();
    cleanup();
    renderAt("/cuentas/00000000-0000-4000-8000-000000000404", <AccountDetailPage />);
    expect(await screen.findByText("La cuenta no está disponible.")).toBeInTheDocument();
    cleanup();
    renderAt(`/cuentas/${accountId}/movimientos?page=1&pageSize=20`, <MovementsPage />);
    expect(await screen.findByText(/Salida/)).toBeInTheDocument();
    const menus = screen.getAllByRole("button", { name: /Opciones del movimiento/ });
    await user.click(menus[0] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "Detalle de la operación" }));
    expect(await screen.findByText(/Concepto Compra/)).toBeInTheDocument();
    await user.click(menus[1] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "Detalle de la operación" }));
    expect(await screen.findByText(/no trae concepto/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Solo entradas" }));
    await user.click(screen.getByRole("button", { name: "Todos" }));
    cleanup();
    renderAt("/transferencias", <TransferPage />);
    expect(await screen.findByRole("option", { name: /Nómina/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Cuenta origen"), accountId);
    await user.type(screen.getByLabelText("Cuenta ocasional"), "1000000000000004");
    await user.type(screen.getByLabelText("Importe MXN"), "10.00");
    await user.type(screen.getByLabelText("Concepto"), "Renta");
    await user.click(screen.getByRole("button", { name: "Revisar transferencia" }));
    expect(await screen.findByText(/No se pudo validar el destinatario/)).toBeInTheDocument();
  });
});
