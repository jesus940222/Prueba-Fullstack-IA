import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "../App";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("preferences shell", () => {
  beforeEach(() => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ permissions: [] }),
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends the home page to login when there is no session", async () => {
    jest.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cuentas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Banca" })).not.toBeInTheDocument();
  });

  it("rejects an empty display name and keeps a valid one on the page", async () => {
    const user = userEvent.setup();
    renderAt("/preferencias");
    await user.click(await screen.findByRole("button", { name: "Guardar en este dispositivo" }));
    expect(await screen.findByText("Escribe un nombre para mostrar")).toBeInTheDocument();
    expect(await screen.findByText("Revisa el nombre antes de guardar.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nombre para mostrar"), "Ana López");
    await user.click(screen.getByRole("button", { name: "Guardar en este dispositivo" }));
    expect(await screen.findByText(/El nombre queda solo en esta pantalla: Ana López/)).toBeInTheDocument();
  });

  it("opens profile sections from the home navigation", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(await screen.findByRole("button", { name: "Menú" }));
    await user.click(screen.getByRole("link", { name: "Perfil" }));
    expect(await screen.findByRole("tab", { name: "Límites" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Seguridad" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Preferencias" })).not.toBeInTheDocument();
  });
});
