import { expect, test } from "@playwright/test";

const password = "DevPassword123!";

test("customer browses a live program and safely holds a seat", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByText("NOW PLAYING")).toBeVisible();
  const showtime = page.locator(".program-tile__showtimes button:not([disabled])").first();
  const showtimeDates = page.getByRole("navigation", { name: "Showtime dates" }).getByRole("button");

  for (let index = 0; index < await showtimeDates.count() && await showtime.count() === 0; index += 1) {
    await showtimeDates.nth(index).click();
  }

  await expect(showtime).toBeVisible();
  await showtime.click();
  const seatMap = page.getByRole("region", { name: /seating chart/i });
  await expect(seatMap).toBeVisible();
  const seat = seatMap.locator("button:not([disabled])").first();
  await seat.click();
  await expect(page.getByText("Seats held")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to tickets" })).toBeEnabled();
});

test("staff signs in, clocks in, and reaches live operational tools", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001");
  await page.getByLabel("Email").fill("owner@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();
  await page.getByLabel("Employee PIN").fill("1234");
  await page.getByRole("button", { name: "Enter POS" }).click();
  await expect(page.getByRole("navigation", { name: "Staff tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan tickets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Box office" })).toBeVisible();
});

test("manager signs in and reaches reporting and configuration", async ({ page }) => {
  await page.goto("http://127.0.0.1:3003");
  await page.getByLabel("Email").fill("owner@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("ATTEND · CINEMA CONFIG")).toBeVisible();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Reports & Finance" }).click();
  await expect(page.getByRole("heading", { name: "Reports & finance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue overview" })).toBeVisible();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Users & Permissions" }).click();
  await expect(page.getByRole("heading", { name: "Role access" })).toBeVisible();
});
