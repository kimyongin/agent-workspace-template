import { type Locator, type Page } from "@playwright/test";

/** Select a visible choice through the control the user operates. */
export async function chooseSetting(page: Page, control: Locator, label: string) {
  if (await control.evaluate(element => element instanceof HTMLSelectElement)) {
    await control.selectOption({ label });
    return;
  }
  await control.click();
  const input = await control.evaluate(element => element instanceof HTMLInputElement);
  if (input) await control.fill(label);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("option", { name: new RegExp(`^${escaped}(?: ·|$)`) }).click();
}
