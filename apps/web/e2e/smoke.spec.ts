import { expect, test } from "@playwright/test";

/** The launch screen at 390×844 renders with no console errors and honest empty/disconnected states. */
test("the prompt screen renders at phone width without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto("/");
  await expect(page.getByTestId("prompt-box")).toBeVisible();
  await expect(page.getByPlaceholder("a coin about…")).toBeVisible();
  await expect(page.getByTestId("launch-button")).toBeVisible();
  await expect(page.getByTestId("launch-button")).toHaveAttribute("data-state", "disabled");
  await expect(page.getByTestId("connect-x")).toBeVisible();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
  await expect(page.getByTestId("chamber")).toBeVisible();
  await expect(page.getByTestId("footer")).toContainText("A meme, not an investment.");
  // the cost line waits on /api/status, which builds every shared client on the first request of a dev server
  await expect(page.getByTestId("cost-line")).toContainText("you pay", { timeout: 60_000 });

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);

  // give the chamber's dynamic import time to settle so a render error would be caught
  await page.waitForTimeout(2500);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("/status, /me and /how render honest states", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/status");
  await expect(page.getByText("Providers")).toBeVisible();
  await page.goto("/me");
  await expect(page.getByText("Nothing waiting for you.")).toBeVisible();
  await page.goto("/how");
  await expect(page.getByTestId("doc").first()).toBeVisible();
  expect(errors).toEqual([]);
});
