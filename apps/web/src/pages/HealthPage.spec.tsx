import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "../App";

function renderHealth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/salud"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("health page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the service response when the endpoint answers", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    } as Response);
    renderHealth();
    expect(await screen.findByText("Respuesta del servicio: ok")).toBeInTheDocument();
  });

  it("shows an error when the endpoint is unavailable", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/access/me")) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 503 } as Response;
    });
    renderHealth();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo consultar la salud");
  });
});
