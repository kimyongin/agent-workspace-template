import { expect, type Locator, type Page } from "@playwright/test";

/** Direct data rows exclude column headings, expanded details and nested tables. */
export function businessRows(table: Locator) {
  return table.locator(":scope > tbody > tr").filter({ has: table.page().locator(":scope > td:not([colspan])") });
}

/** Follow the public disclosure relationship rather than a component's card wrapper. */
export async function disclosureContent(page: Page, trigger: Locator) {
  await expect(trigger).toHaveAttribute("aria-controls", /.+/);
  return page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
}

/** Read-only metadata follows its summary in the next spanning table row. */
export function entryDetails(row: Locator) {
  return row.locator("xpath=following-sibling::tr[1]").filter({ has: row.page().locator(":scope > td[colspan]") });
}

/** Locate a value using its actual column heading and native headers association. */
export async function valueCell(row: Locator, label: string) {
  const heading = row.locator("xpath=ancestor::table[1]").getByRole("columnheader", { name: label, exact: true });
  await expect(heading).toHaveAttribute("id", /.+/);
  return row.locator(`[headers="${await heading.getAttribute("id")}"]`);
}
