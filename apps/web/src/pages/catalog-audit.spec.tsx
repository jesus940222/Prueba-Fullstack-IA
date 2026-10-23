import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuditPage, formatMexico } from "./AuditPage";
import { CatalogAdminPage } from "./CatalogAdminPage";
import { OffersPage } from "./OffersPage";
import { ProductDetailPage } from "./ProductDetailPage";
import { ProductsPage } from "./ProductsPage";

function renderAt(path: string, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/productos" element={element} />
          <Route path="/productos/:productId" element={element} />
          <Route path="/ofertas" element={element} />
          <Route path="/catalogo" element={element} />
          <Route path="/auditoria" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("catalog and audit screens", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows products, an empty offer list and a dependency failure", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/products")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "1", code: "fondo-diario", name: "Fondo diario", currency: "MXN", termsVersion: 1 }], totalItems: 1, page: 1, totalPages: 1 }) } as Response;
      }
      if (url.includes("/me/offers")) {
        return { ok: false, status: 503, json: async () => ({ code: "DEPENDENCY_UNAVAILABLE" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [], totalItems: 0, page: 1, totalPages: 0 }) } as Response;
    });
    renderAt("/productos?page=1", <ProductsPage />);
    expect(await screen.findByText(/Fondo diario/)).toBeInTheDocument();
    renderAt("/ofertas", <OffersPage />);
    expect(await screen.findByText(/No se pudo comprobar la elegibilidad/)).toBeInTheDocument();
    renderAt("/productos?categoryId=no", <ProductsPage />);
    expect(await screen.findByText("Los filtros de la dirección no son válidos.")).toBeInTheDocument();
  });

  it("creates a category and rejects an invalid code", async () => {
    const user = userEvent.setup();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "1", code: "inversion", name: "Inversión", status: "active" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [], totalItems: 0 }) } as Response;
    });
    renderAt("/catalogo?includeDeleted=false", <CatalogAdminPage />);
    expect(await screen.findByText("No hay categorías en esta página.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Código"), "Inversión");
    await user.type(screen.getByLabelText("Nombre"), "Inversión");
    await user.click(screen.getByRole("button", { name: "Crear categoría" }));
    expect(await screen.findByText("Usa un código en minúsculas")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Código"));
    await user.type(screen.getByLabelText("Código"), "inversion");
    await user.click(screen.getByRole("button", { name: "Crear categoría" }));
    expect(await screen.findByText("Categoría creada.")).toBeInTheDocument();
  });

  it("lists audit events in Mexico time and blocks a bad filter", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ eventId: "1", eventType: "session.revoked", occurredAt: "2026-10-21T18:00:00.000Z", sourceService: "access", outcome: "success", correlationId: "33333333-3333-4333-8333-333333333333", actorId: "2" }],
        totalItems: 1,
        page: 1,
        totalPages: 1,
      }),
    } as Response);
    renderAt("/auditoria?sourceService=access&outcome=success", <AuditPage />);
    expect(await screen.findByText(/session.revoked/)).toBeInTheDocument();
    expect(screen.getByText(/access/)).toBeInTheDocument();
    renderAt("/auditoria?outcome=maybe", <AuditPage />);
    expect(await screen.findByText("Los filtros de la dirección no son válidos.")).toBeInTheDocument();
    expect(formatMexico("2026-10-21T18:00:00.000Z")).toMatch(/21\/10\/26/);
    expect(formatMexico("no-fecha")).toBe("no-fecha");
  });

  it("shows a product detail and rejects a malformed id", async () => {
    const productId = "00000000-0000-4000-8000-0000000000a1";
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("00000000-0000-4000-8000-000000000403")) {
        return { ok: false, status: 403, json: async () => ({}) } as Response;
      }
      if (url.includes("/products/")) {
        return { ok: true, status: 200, json: async () => ({ id: productId, code: "fondo-diario", name: "Fondo diario", currency: "MXN", summary: "Liquidez", description: "Texto", termsVersion: 1, termsText: "Condiciones" }) } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    });
    renderAt(`/productos/${productId}`, <ProductDetailPage />);
    expect(await screen.findByText("Liquidez")).toBeInTheDocument();
    expect(screen.getByText("Condiciones")).toBeInTheDocument();
    renderAt("/productos/no", <ProductDetailPage />);
    expect(await screen.findByText(/No se consultó el producto/)).toBeInTheDocument();
    renderAt("/productos/00000000-0000-4000-8000-000000000403", <ProductDetailPage />);
    expect(await screen.findByText("No tienes permiso para ver productos.")).toBeInTheDocument();
  });
});
