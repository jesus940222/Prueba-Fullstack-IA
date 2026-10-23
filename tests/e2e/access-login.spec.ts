import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_BOOTSTRAP_PASSWORD ?? "";

async function clearMailbox(): Promise<void> {
  const response = await fetch("http://127.0.0.1:8025/api/v1/messages", { method: "DELETE" });
  if (!response.ok && response.status !== 200) {
    throw new Error(`mailbox_clear_${response.status}`);
  }
}

async function latestCode(email: string): Promise<string> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const list = await fetch("http://127.0.0.1:8025/api/v1/messages");
    const body = (await list.json()) as { messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }> };
    const message = body.messages?.find((item) => item.To?.some((to) => to.Address === email));
    if (message) {
      const detail = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`);
      const full = (await detail.json()) as { Text?: string };
      const code = full.Text?.match(/Código:\s*(\d{6})/)?.[1];
      if (code) {
        return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("mailbox_code_missing");
}

async function login(page: Page, email: string): Promise<void> {
  await clearMailbox();
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Código")).toBeVisible();
  await page.getByLabel("Código").fill(await latestCode(email));
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
}

test.beforeAll(() => {
  if (password === "") {
    throw new Error("missing_bootstrap_password");
  }
});

test("logs in through the local mailbox and hides the directory without permission", async ({ page }) => {
  await login(page, "diego.admin@portal.local");
  await page.goto("/perfil");
  await expect(page.getByText("Diego Admin · diego.admin@portal.local")).toBeVisible();
  await page.goto("/sesiones");
  await expect(page.getByText(/Sesiones: /)).toBeVisible();
  await expect(page.getByText("password", { exact: true }).first()).toBeVisible();
  await page.goto("/usuarios");
  await expect(page.getByRole("columnheader", { name: "Rol" })).toBeVisible();
  await expect(page.getByText("ana.cliente@portal.local")).toBeVisible();
  await expect(page.getByText("cliente", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("administrador", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Agregar usuario" }).click();
  await expect(page.getByRole("dialog", { name: "Agregar usuario" }).getByRole("button", { name: /Rol/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Opciones de ana.cliente@portal.local" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("dialog", { name: "Editar usuario" }).getByRole("button", { name: /Rol/ })).toContainText("cliente");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.goto("/roles");
  await expect(page.getByText(/administrador · administrador/)).toBeVisible();
  await page.goto("/sesiones");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "ana.cliente@portal.local");
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
  await page.goto("/usuarios");
  await expect(page.getByText("No tienes permiso para ver usuarios.")).toBeVisible();
  await page.goto("/roles");
  await expect(page.getByText("No tienes permiso para ver roles.")).toBeVisible();
});
