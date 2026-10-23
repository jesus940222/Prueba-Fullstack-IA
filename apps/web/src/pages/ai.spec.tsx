import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AiAdminPage } from "./AiAdminPage";
import { ChatPage } from "./ChatPage";

function renderAt(path: string, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/chat" element={element} />
          <Route path="/ia" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ai screens", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows an incomplete measurement and confirms only through accounts", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/conversations") && init?.method === "POST") {
        return json({ id: "11111111-1111-4111-8111-111111111111", title: "Nueva conversación", status: "active" });
      }
      if (url.includes("/messages") && init?.method === "POST") {
        return json({ runId: "22222222-2222-4222-8222-222222222222", conversationId: "11111111-1111-4111-8111-111111111111" }, 202);
      }
      if (url.includes("/me/permissions")) {
        return json({ permissions: ["ai:chat:use", "ai:metrics:read:own", "ai:metrics:read:any"] });
      }
      if (url.includes("/events")) {
        return { ok: true, status: 200, text: async () => 'event: confirmation_required\ndata: {"type":"confirmation_required","proposalId":"33333333-3333-4333-8333-333333333333","text":"reglamento v1"}\n\n' } as Response;
      }
      if (url.includes("/transfer-proposals/") && url.endsWith("/confirm")) {
        return json({});
      }
      if (url.includes("/transfer-proposals/")) {
        return json({ id: "33333333-3333-4333-8333-333333333333", status: "pending", amount: "10.00", currency: "MXN", concept: "Prueba", destinationLabel: "Bruno", expiresAt: "2099-01-01T00:00:00Z" });
      }
      if (url.includes("/metrics")) {
        return json({ usageComplete: false, estimatedCostUsd: null, model: "gpt-6-luna", inputTokens: null, outputTokens: null, cachedTokens: null, totalTokens: null, latencyMs: null });
      }
      if (url.includes("/messages")) {
        return json({ items: [], nextCursor: null, hasMore: false });
      }
      return json({ items: [] });
    });
    renderAt("/chat", <ChatPage />);
    await user.type(await screen.findByLabelText("Mensaje"), "Transfiere 10 pesos");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Medición incompleta. No se muestra el coste como cero.")).toBeTruthy();
    const references = screen.getByText("Referencias").closest("details");
    expect(references).not.toHaveAttribute("open");
    expect(references).toHaveTextContent("Fuentes: reglamento v1");
    await user.click(screen.getByRole("button", { name: "Confirmar transferencia" }));
    expect((await screen.findAllByText("Cuentas confirmó la transferencia.")).length).toBeGreaterThan(0);
    const confirmCall = (globalThis.fetch as jest.Mock).mock.calls.find((call) => String(call[0]).includes("/confirm"));
    expect(String(confirmCall?.[0])).toContain("/api/v1/accounts/transfer-proposals/");
  });

  it("hides run costs from a customer and keeps references collapsed", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/conversations") && init?.method === "POST") {
        return json({ id: "11111111-1111-4111-8111-111111111111", title: "Nueva conversación", status: "active" });
      }
      if (url.includes("/me/permissions")) {
        return json({ permissions: ["ai:chat:use", "accounts:read:own", "ai:metrics:read:own"] });
      }
      if (url.includes("/messages") && init?.method === "POST") {
        return json({ runId: "22222222-2222-4222-8222-222222222222", conversationId: "11111111-1111-4111-8111-111111111111" }, 202);
      }
      if (url.includes("/events")) {
        return { ok: true, status: 200, text: async () => 'event: completed\ndata: {"text":"reglamento v1"}\n\n' } as Response;
      }
      if (url.includes("/messages")) {
        return json({ items: [{ id: "m-1", role: "user", content: "Hola" }], nextCursor: null, hasMore: false });
      }
      return json({ items: [] });
    });
    renderAt("/chat", <ChatPage />);
    await user.type(await screen.findByLabelText("Mensaje"), "Hola");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const references = (await screen.findByText("Referencias")).closest("details");
    expect(references).not.toHaveAttribute("open");
    expect(screen.queryByText("Métricas de la respuesta")).toBeNull();
    expect(screen.queryByText(/Coste estimado/)).toBeNull();
    expect((globalThis.fetch as jest.Mock).mock.calls.some((call) => String(call[0]).includes("/metrics"))).toBe(false);
  });

  it("shows the user message before the assistant responds", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/conversations") && init?.method === "POST") {
        return json({ id: "11111111-1111-4111-8111-111111111111", title: "Nueva conversación", status: "active" });
      }
      if (url.includes("/me/permissions")) {
        return json({ permissions: ["ai:chat:use", "accounts:read:own"] });
      }
      if (url.includes("/messages") && init?.method === "POST") {
        await gate;
        accepted = true;
        return json({ runId: "22222222-2222-4222-8222-222222222222" }, 202);
      }
      if (url.includes("/events")) {
        return { ok: true, status: 200, text: async () => "event: completed\ndata: {}\n\n" } as Response;
      }
      if (url.includes("/messages")) {
        return json({ items: accepted ? [{ id: "m-1", role: "user", content: "Hola" }] : [], nextCursor: null, hasMore: false });
      }
      return json({ items: [] });
    });
    renderAt("/chat", <ChatPage />);
    await user.type(await screen.findByLabelText("Mensaje"), "Hola");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Hola")).toBeTruthy();
    expect(screen.getByLabelText("Mensaje")).toHaveValue("");
    release();
    await waitFor(() => expect(screen.queryByText("Escribiendo…")).toBeNull());
    expect(screen.getAllByText("Hola")).toHaveLength(1);
  });

  it("deletes the conversation when the bubble closes", async () => {
    const user = userEvent.setup();
    const deleted: string[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/conversations") && init?.method === "POST") {
        return json({ id: "11111111-1111-4111-8111-111111111111", title: "Nueva conversación", status: "active" });
      }
      if (init?.method === "DELETE") {
        deleted.push(url);
        return { ok: true, status: 204, json: async () => ({}), text: async () => "" } as Response;
      }
      return json({ items: [] });
    });
    renderAt("/chat", <ChatPage />);
    expect(await screen.findByRole("dialog", { name: "Asistente" })).toBeTruthy();
    expect(await screen.findByText("Escribe un mensaje para empezar.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    await waitFor(() => expect(deleted.some((url) => url.includes("/conversations/11111111-1111-4111-8111-111111111111"))).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));
    expect(await screen.findByText("Escribe un mensaje para empezar.")).toBeTruthy();
  });

  it("shows a denial when the assistant cannot be opened", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "" }) as Response);
    renderAt("/chat", <ChatPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para usar el asistente.");
  });

  it("keeps administrative metrics away from a user without permission", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ code: "PERMISSION_DENIED" }) }) as Response);
    renderAt("/ia", <AiAdminPage />);
    expect(await screen.findByText("No tienes permiso para consultar las métricas o las alertas.")).toBeTruthy();
  });

  it("shows an incomplete measurement on the dashboard without treating it as zero", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/alerts")) {
        return json({ items: [], totalItems: 0, totalPages: 0, page: 1 });
      }
      return json({ from: "2026-10-22T00:00:00Z", to: "2026-10-23T00:00:00Z", runCount: 2, usageComplete: false, estimatedCostUsd: null, inputTokens: null, outputTokens: null, cachedTokens: null, totalTokens: null });
    });
    renderAt("/ia", <AiAdminPage />);
    expect(await screen.findByText("2 ejecuciones")).toBeTruthy();
    expect(screen.getByText("Medición incompleta. No se muestra el coste como cero.")).toBeTruthy();
    expect(screen.getByText("Tokens no disponibles mientras la medición esté incompleta.")).toBeTruthy();
    expect(screen.getByText("No hay alertas.")).toBeTruthy();
  });

  it("shows complete usage and acknowledges an open alert", async () => {
    const user = userEvent.setup();
    let acknowledged = false;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/acknowledge")) {
        acknowledged = true;
        return json({});
      }
      if (url.includes("/alerts")) {
        return json({
          items: [{ id: "alert-1", scope: "diario", observedValueUsd: "1.50", status: acknowledged ? "acknowledged" : "open" }],
          totalItems: 1,
          totalPages: 1,
          page: 1,
        });
      }
      if (init?.method === "POST") {
        return json({});
      }
      return json({
        from: "2026-10-22T00:00:00Z",
        to: "2026-10-23T00:00:00Z",
        runCount: 4,
        usageComplete: true,
        estimatedCostUsd: "0.02",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 1,
        totalTokens: 16,
      });
    });
    renderAt("/ia", <AiAdminPage />);
    expect(await screen.findByText("Coste estimado 0.02 USD.")).toBeTruthy();
    expect(screen.getByText("1 alerta registrada")).toBeTruthy();
    expect(screen.getByText("diario")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Opciones de diario" }));
    await user.click(screen.getByRole("menuitem", { name: "Reconocer" }));
    expect(await screen.findByText("Reconocida")).toBeTruthy();
  });
});

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
