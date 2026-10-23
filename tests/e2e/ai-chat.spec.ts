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

test("opens the assistant without confirming a transfer and keeps admin metrics away from Ana", async ({ page }) => {
  await login(page, "ana.cliente@portal.local");
  await page.goto("/chat");
  await expect(page.getByRole("dialog", { name: "Asistente" })).toBeVisible();
  const prompt = "Resume en una frase la documentación vigente sobre el uso del portal. No prepares ninguna transferencia.";
  await page.getByLabel("Mensaje").fill(prompt);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(prompt)).toBeVisible();
  await expect.poll(async () => {
    const writing = await page.getByText("Escribiendo…").count();
    const assistantReplies = await page.locator(".assistant-bubble.is-assistant").count();
    const failed = await page.getByText(/La ejecución no se completó|El modelo no está disponible|No se pudo enviar/).count();
    return writing === 0 && (assistantReplies > 0 || failed > 0);
  }, { timeout: 90000 }).toBe(true);
  await expect(page.getByText("Métricas de la respuesta")).toHaveCount(0);
  await expect(page.getByText(/Coste estimado/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirmar transferencia" })).toHaveCount(0);
  await page.goto("/ia");
  await expect(page.getByText("No tienes permiso para consultar las métricas o las alertas.")).toBeVisible();

  await login(page, "diego.admin@portal.local");
  await page.goto("/ia");
  await expect(page.getByRole("heading", { name: "Métricas y alertas" })).toBeVisible();
  await expect(page.getByText("Resume en una frase la documentación vigente sobre el uso del portal. No prepares ninguna transferencia.")).toHaveCount(0);
});
