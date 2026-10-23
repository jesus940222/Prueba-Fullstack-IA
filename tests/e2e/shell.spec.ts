import { expect, test } from "@playwright/test";

test("keeps the portal behind the login screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Banca" })).toHaveCount(0);

  await page.goto("/preferencias");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();

  await page.goto("/entrar");
  await expect(page).toHaveURL(/\/login$/);
});
