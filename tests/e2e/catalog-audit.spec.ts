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
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Código").fill(await latestCode(email));
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
}

test.beforeAll(() => {
  if (password === "") {
    throw new Error("missing_bootstrap_password");
  }
});

test("shows eligible offers to Ana and keeps catalog administration away from her", async ({ page }) => {
  await login(page, "ana.cliente@portal.local");
  await page.goto("/productos");
  await expect(page.getByRole("link", { name: "Fondo diario" })).toBeVisible();
  await expect(page.getByText("Producto retirado")).toHaveCount(0);
  await page.goto("/ofertas");
  await expect(page.getByText("Bienvenida general")).toBeVisible();
  await expect(page.getByText("Saldo ilustrativo")).toBeVisible();
  await expect(page.getByText("Seguro dirigido")).toBeVisible();
  await expect(page.getByText("Campaña vencida")).toHaveCount(0);
  await page.goto("/catalogo");
  await expect(page.getByText("No tienes permiso para administrar el catálogo.")).toBeVisible();

  await login(page, "bruno.soporte@portal.local");
  await page.goto("/ofertas");
  await expect(page.getByText("No tienes permiso para ver ofertas.")).toBeVisible();

  await login(page, "elena.gestor@portal.local");
  await page.goto("/catalogo?includeDeleted=false");
  await expect(page.getByText("Inversión")).toBeVisible();
  await expect(page.getByRole("link", { name: "Auditoría" })).toHaveCount(0);

  await login(page, "carla.auditor@portal.local");
  await page.goto("/auditoria?sourceService=access");
  await expect(page.getByRole("heading", { name: "Auditoría" })).toBeVisible();
  await expect(page.getByText("No tienes permiso para consultar la auditoría.")).toHaveCount(0);
});
