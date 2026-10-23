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
  await page.getByLabel("Código").fill(await latestCode(email));
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
}

test.beforeAll(() => {
  if (password === "") {
    throw new Error("missing_bootstrap_password");
  }
});

test("confirms an own transfer and rejects a user without the permission", async ({ page }) => {
  await login(page, "ana.cliente@portal.local");
  const before = await page.getByText(/Saldo disponible/).innerText();
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: "Nómina" })).toBeVisible();
  await page.goto("/beneficiarios");
  await expect(page.getByText("Bruno")).toBeVisible();
  await page.goto("/transferencias");
  await page.getByRole("button", { name: "Revisar transferencia" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  const source = page.getByLabel("Cuenta origen");
  await source.selectOption(await source.locator("option", { hasText: "Nómina" }).getAttribute("value") ?? "");
  const beneficiary = page.getByLabel("Beneficiario guardado");
  await beneficiary.selectOption(await beneficiary.locator("option", { hasText: "Bruno" }).getAttribute("value") ?? "");
  await page.getByLabel("Importe MXN").fill("1.00");
  await page.getByLabel("Concepto").fill("Prueba local");
  await page.getByRole("button", { name: "Revisar transferencia" }).click();
  await expect(page.getByText("Importe $1.00 MXN")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar transferencia" }).click();
  const receipt = page.getByRole("heading", { name: "Comprobante" });
  const uncertain = page.getByRole("button", { name: "Comprobar estado" });
  await expect(receipt.or(uncertain)).toBeVisible();
  if (await uncertain.isVisible()) {
    await uncertain.click();
    await expect(receipt).toBeVisible();
  }
  await page.goto("/");
  const after = await page.getByText(/Saldo disponible/).innerText();
  expect(amountOf(after).toFixed(2)).toBe((amountOf(before) - 1).toFixed(2));

  await page.context().clearCookies();
  await login(page, "bruno.soporte@portal.local");
  await page.goto("/cuentas");
  await expect(page.getByText("No tienes permiso para ver cuentas.")).toBeVisible();
});

function amountOf(text: string): number {
  const match = text.match(/\$([0-9,]+\.[0-9]{2})/);
  if (!match?.[1]) {
    throw new Error("balance_missing");
  }
  return Number(match[1].replace(/,/g, ""));
}
