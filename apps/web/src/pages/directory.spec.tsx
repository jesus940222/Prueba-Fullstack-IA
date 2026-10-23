import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "../App";
import { ProfilePage } from "./ProfilePage";

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

describe("access screens", () => {
  it("rejects a bad sessions page and lists users only with permission", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/permissions")) {
        return { ok: true, status: 200, json: async () => ({ permissions: ["users:read"] }) };
      }
      if (url.includes("/users?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "1", email: "ana@portal.local", status: "active" }], totalItems: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    renderAt("/sesiones?page=0");
    expect(await screen.findByText("La página indicada en la dirección no es válida.")).toBeInTheDocument();
    cleanup();
    renderAt("/usuarios?includeDeleted=false");
    expect(await screen.findByText(/ana@portal.local/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Menú" })[0] ?? screen.getByRole("button", { name: "Menú" }));
    expect(screen.getByRole("link", { name: "Usuarios" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Roles" })).not.toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("lists roles when the session can read them", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/permissions")) {
        return { ok: true, status: 200, json: async () => ({ permissions: ["users:read", "roles:read", "users:roles:read"] }) };
      }
      if (url.includes("/applications?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "app-1", code: "portal", name: "Portal" }] }) };
      }
      if (url.includes("/roles?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "role-1", code: "administrador", name: "Administrador", system: true }], totalItems: 1 }) };
      }
      if (url.includes("/role-assignments")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "as-1", roleId: "role-1", expiresAt: null }], totalItems: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderAt("/roles?page=0");
    expect(await screen.findByText("Los filtros de la dirección no son válidos.")).toBeInTheDocument();
    cleanup();
    renderAt("/roles");
    expect(await screen.findByText(/Administrador/)).toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("invites, edits and deletes a user from the directory table", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/me/permissions")) {
        return { ok: true, status: 200, json: async () => ({ permissions: ["users:read", "users:create", "users:update", "users:delete"] }) };
      }
      if (url.endsWith("/access/me")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/users?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "user-1", email: "ana@portal.local", givenName: "Ana", familyName: "López", status: "active" }], totalItems: 1, page: 1, totalPages: 1 }) };
      }
      if (method === "POST" && url.endsWith("/access/users")) {
        return { ok: true, status: 201, json: async () => ({ id: "user-2", email: "nuevo@portal.local", status: "invited" }) };
      }
      if (method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({ id: "user-1", email: "ana@portal.local", status: "active" }) };
      }
      if (method === "DELETE") {
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.includes("/users/user-1")) {
        return { ok: true, status: 200, json: async () => ({ id: "user-1", email: "ana@portal.local", givenName: "Ana", familyName: "López", status: "active" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderAt("/usuarios");
    expect(await screen.findByRole("columnheader", { name: "Correo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar usuario" }));
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect((await screen.findAllByText("Escribe un correo válido")).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("Correo"), "nuevo@portal.local");
    await user.type(screen.getByLabelText("Nombre"), "Nuevo");
    await user.type(screen.getByLabelText("Apellidos"), "Usuario");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(await screen.findByText("Usuario invitado. La contraseña no se muestra.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de ana@portal.local" }));
    expect(screen.queryByRole("menuitem", { name: "Asignaciones" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(await screen.findByRole("heading", { name: "Editar usuario" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Usuario actualizado.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de ana@portal.local" }));
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    expect(await screen.findByText("Usuario eliminado. Sus sesiones quedan revocadas.")).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith("POST ") && call.endsWith("/access/users"))).toBe(true);
    expect(calls.some((call) => call.startsWith("PATCH "))).toBe(true);
    expect(calls.some((call) => call.startsWith("DELETE "))).toBe(true);
    globalThis.fetch = original;
  });

  it("shows the role in the directory and assigns it from invite and edit", async () => {
    const user = userEvent.setup();
    const userBodies: unknown[] = [];
    const assignmentPosts: unknown[] = [];
    const assignmentDeletes: string[] = [];
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/me/permissions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ permissions: ["users:read", "users:create", "users:update", "roles:read", "users:roles:read", "users:roles:assign", "users:roles:revoke"] }),
        };
      }
      if (url.endsWith("/access/me")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/applications?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "app-1", code: "portal", name: "Portal" }] }) };
      }
      if (url.includes("/roles?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "role-1", code: "administrador", name: "Administrador" },
              { id: "role-2", code: "consulta", name: "Consulta" },
            ],
            totalItems: 2,
            page: 1,
            totalPages: 1,
          }),
        };
      }
      if (url.includes("/role-assignments")) {
        if (method === "POST") {
          assignmentPosts.push(JSON.parse(String(init?.body)));
          return { ok: true, status: 204, json: async () => ({}) };
        }
        if (method === "DELETE") {
          assignmentDeletes.push(url);
          return { ok: true, status: 204, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "as-1", roleId: "role-1", expiresAt: null }], totalItems: 1, page: 1, totalPages: 1 }) };
      }
      if (url.includes("/users?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "user-1", email: "ana@portal.local", givenName: "Ana", familyName: "López", status: "active" }], totalItems: 1, page: 1, totalPages: 1 }) };
      }
      if (method === "POST" && url.endsWith("/access/users")) {
        userBodies.push(JSON.parse(String(init?.body)));
        return { ok: true, status: 201, json: async () => ({ id: "user-2", email: "nuevo@portal.local", status: "invited" }) };
      }
      if (method === "PATCH") {
        userBodies.push(JSON.parse(String(init?.body)));
        return { ok: true, status: 200, json: async () => ({ id: "user-1", email: "ana@portal.local", status: "active" }) };
      }
      if (url.includes("/users/user-1")) {
        return { ok: true, status: 200, json: async () => ({ id: "user-1", email: "ana@portal.local", givenName: "Ana", familyName: "López", status: "active" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderAt("/usuarios");
    expect(await screen.findByRole("columnheader", { name: "Rol" })).toBeInTheDocument();
    expect(await screen.findByText("Administrador")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar usuario" }));
    expect(await screen.findByRole("button", { name: /Rol/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Correo"), "nuevo@portal.local");
    await user.type(screen.getByLabelText("Nombre"), "Nuevo");
    await user.type(screen.getByLabelText("Apellidos"), "Usuario");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect((await screen.findAllByText("Elige un rol.")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Rol/ }));
    await user.click(await screen.findByRole("option", { name: "Administrador" }));
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(await screen.findByText("Usuario invitado. La contraseña no se muestra.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de ana@portal.local" }));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(await screen.findByRole("heading", { name: "Editar usuario" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Rol/ })).toHaveTextContent("Administrador");
    await user.click(screen.getByRole("button", { name: /Rol/ }));
    await user.click(await screen.findByRole("option", { name: "Consulta" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Usuario actualizado.")).toBeInTheDocument();
    expect(userBodies).toEqual([
      { email: "nuevo@portal.local", givenName: "Nuevo", familyName: "Usuario" },
      { givenName: "Ana", familyName: "López", status: "active" },
    ]);
    expect(assignmentPosts).toEqual([{ roleId: "role-1" }, { roleId: "role-2" }]);
    expect(assignmentDeletes.some((url) => url.endsWith("/role-assignments/as-1"))).toBe(true);
    globalThis.fetch = original;
  });

  it("creates and deletes a custom role and keeps system roles locked", async () => {
    const user = userEvent.setup();
    const writes: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/me/permissions")) {
        return { ok: true, status: 200, json: async () => ({ permissions: ["roles:read", "roles:create", "roles:update", "roles:delete", "roles:permissions:assign", "permissions:read", "users:read"] }) };
      }
      if (url.endsWith("/access/me")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/applications?")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "app-1", code: "portal", name: "Portal" }] }) };
      }
      if (url.includes("/permissions?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { code: "users:read", resource: "users", action: "read", scope: "any" },
              { code: "accounts:read:own", resource: "accounts", action: "read", scope: "own" },
            ],
            totalItems: 2,
            totalPages: 1,
            page: 1,
            pageSize: 100,
          }),
        };
      }
      if (url.includes("/roles?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "role-1", code: "administrador", name: "Administrador", system: true },
              { id: "role-2", code: "consulta", name: "Consulta", system: false, description: "Lectura" },
            ],
            totalItems: 2,
            page: 1,
            totalPages: 1,
          }),
        };
      }
      if (method === "DELETE") {
        return { ok: false, status: 409, json: async () => ({ message: "El rol tiene asignaciones activas" }) };
      }
      if (method === "PUT" && url.endsWith("/permissions")) {
        writes.push({ method, url, body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, json: async () => ({ id: "role-2", code: "consulta", name: "Consulta", system: false, version: 3, permissions: ["accounts:read:own"] }) };
      }
      if (url.endsWith("/roles/role-2")) {
        if (method === "PATCH") {
          writes.push({ method, url, body: JSON.parse(String(init?.body)) });
        }
        return { ok: true, status: 200, json: async () => ({ id: "role-2", code: "consulta", name: "Consulta", system: false, description: "Lectura", version: 2, permissions: ["users:read"] }) };
      }
      if (method === "POST" && url.endsWith("/roles")) {
        const body = JSON.parse(String(init?.body)) as { permissionCodes: string[] };
        expect(body.permissionCodes).toEqual(["users:read"]);
        return { ok: true, status: 201, json: async () => ({ id: "role-3", code: "consulta-nueva", name: "Consulta nueva", system: false }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderAt("/roles");
    await user.click(await screen.findByRole("button", { name: "Opciones de Administrador" }));
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Eliminar" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Agregar rol" }));
    await user.type(screen.getByLabelText("Código"), "consulta-nueva");
    await user.type(screen.getByLabelText("Nombre"), "Consulta nueva");
    await user.click(await screen.findByRole("checkbox", { name: "users:read" }));
    await user.click(screen.getByRole("button", { name: "Crear rol" }));
    expect(await screen.findByText("Rol creado.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de Consulta" }));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(await screen.findByRole("heading", { name: "Editar rol" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "users:read" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "accounts:read:own" }));
    await user.click(screen.getByRole("checkbox", { name: "users:read" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Rol actualizado.")).toBeInTheDocument();
    expect(writes).toEqual([
      { method: "PATCH", url: expect.stringMatching(/\/roles\/role-2$/), body: { name: "Consulta", description: "Lectura" } },
      { method: "PUT", url: expect.stringMatching(/\/roles\/role-2\/permissions$/), body: { version: 2, permissionCodes: ["accounts:read:own"] } },
    ]);
    await user.click(screen.getByRole("button", { name: "Opciones de Consulta" }));
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    expect((await screen.findAllByText("El rol tiene asignaciones activas")).length).toBeGreaterThan(0);
    globalThis.fetch = original;
  });

  it("shows the passkey policy message when the authenticator is missing", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/passkey-policy")) {
        return { ok: false, status: 403, json: async () => ({ message: "No tienes permiso para esta operación" }) };
      }
      if (url.includes("/passkeys/registration/options")) {
        return { ok: false, status: 422, json: async () => ({ message: "Un administrador debe habilitar la passkey" }) };
      }
      if (url.includes("/me/passkeys")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "pk-1", name: "Llave local" }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "user-1", givenName: "Ana", familyName: "López", email: "ana@portal.local", themePreference: "system" }) };
    }) as unknown as typeof fetch;
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("tab", { name: "Seguridad" }));
    expect(await screen.findByText("Llave local")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Habilitar passkey" }));
    expect(await screen.findByText("No tienes permiso para esta operación")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar passkey" }));
    expect(await screen.findByText("Un administrador debe habilitar la passkey")).toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("tells the user when the browser cannot create a passkey", async () => {
    const user = userEvent.setup();
    const originalCredential = window.PublicKeyCredential;
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/passkeys/registration/options")) {
        return { ok: true, status: 200, json: async () => ({ challengeId: "00000000-0000-4000-8000-000000000099", options: { challenge: "AQID" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "user-1", givenName: "Ana", familyName: "López", email: "ana@portal.local", themePreference: "system", items: [] }) };
    }) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("tab", { name: "Seguridad" }));
    await user.click(await screen.findByRole("button", { name: "Registrar passkey" }));
    expect(await screen.findByText("Este navegador no tiene un autenticador disponible.")).toBeInTheDocument();
    globalThis.fetch = original;
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: originalCredential });
  });

  it("revokes a session and logs out", async () => {
    const user = userEvent.setup();
    let signedOut = false;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/logout")) {
        signedOut = true;
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.endsWith("/access/me")) {
        return signedOut
          ? { ok: false, status: 401, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/me/permissions")) {
        return { ok: true, status: 200, json: async () => ({ permissions: [] }) };
      }
      if (init?.method === "DELETE" || init?.method === "POST") {
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.includes("/me/sessions")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "00000000-0000-4000-8000-0000000000b1", authenticationMethod: "password", revoked: false }], totalItems: 1, page: 1, pageSize: 20 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderAt("/sesiones");
    expect(await screen.findByText(/password/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opciones de password" }));
    await user.click(screen.getByRole("menuitem", { name: "Revocar" }));
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("rejects a phone number that is not ten digits", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ givenName: "Ana", familyName: "López", email: "ana@portal.local", themePreference: "system" }) })) as unknown as typeof fetch;
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByDisplayValue("Ana")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Teléfono"), "123");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await screen.findByText("Usa 10 dígitos")).toBeInTheDocument();
    globalThis.fetch = original;
  });

  it("saves personal data and theme on separate tabs", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const bodies: unknown[] = [];
    let profile = {
      id: "user-1",
      givenName: "Ana",
      familyName: "López",
      email: "ana@portal.local",
      phoneE164: "+525512345678",
      themePreference: "system" as "system" | "light" | "dark",
    };
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/passkeys")) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { phoneNumber?: string; themePreference?: "system" | "light" | "dark"; givenName?: string; familyName?: string };
        bodies.push(body);
        profile = {
          ...profile,
          givenName: body.givenName ?? profile.givenName,
          familyName: body.familyName ?? profile.familyName,
          phoneE164: body.phoneNumber ? `+52${body.phoneNumber}` : profile.phoneE164,
          themePreference: body.themePreference ?? profile.themePreference,
        };
        return { ok: true, status: 200, json: async () => profile };
      }
      return { ok: true, status: 200, json: async () => profile };
    }) as unknown as typeof fetch;
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByDisplayValue("5512345678")).toBeInTheDocument();
    const phone = screen.getByLabelText("Teléfono");
    await user.clear(phone);
    await user.type(phone, "5587654321");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await screen.findByText("Datos guardados. Teléfono +525587654321.")).toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5587654321");
    await user.click(screen.getByRole("tab", { name: "Apariencia" }));
    await user.click(screen.getByRole("button", { name: /Oscuro/ }));
    await user.click(screen.getByRole("button", { name: "Guardar tema" }));
    expect(await screen.findByText("Tema guardado: Oscuro.")).toBeInTheDocument();
    expect(bodies).toEqual([
      { givenName: "Ana", familyName: "López", phoneCountryCode: "MX", phoneNumber: "5587654321" },
      { themePreference: "dark" },
    ]);
    expect(window.localStorage.getItem("heroui-theme")).toBe("dark");
    window.localStorage.removeItem("heroui-theme");
    globalThis.fetch = original;
  });
});
