import { expect, test } from "@playwright/test";

const password = "DevPassword123!";

test("customer browses a live program and safely holds a seat", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByText("NOW PLAYING")).toBeVisible();
  const showtime = page.locator(".program-tile__showtimes button:not([disabled])").first();
  const showtimeDates = page.getByRole("navigation", { name: "Showtime dates" }).getByRole("button");

  for (let index = 0; index < await showtimeDates.count() && await showtime.count() === 0; index += 1) {
    const date = showtimeDates.nth(index);
    await date.click();
    await expect(date).toHaveClass(/active/);
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

test("customer account session restores from HttpOnly cookies and clears on logout", async ({ page, context }) => {
  for (const path of ["cinema/branding", "cinema/content"]) {
    const publicResponse = await page.request.get(`http://127.0.0.1:3000/api/v1/${path}`);
    expect(publicResponse.status()).toBe(200);
  }

  await page.goto("http://127.0.0.1:3000/account");
  await page.getByLabel("Email").fill("customer@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("SIGNED IN")).toBeVisible();

  const accountResponse = await page.request.get("http://127.0.0.1:3000/api/v1/auth/customers/me");
  expect(accountResponse.status()).toBe(200);

  expect(await page.evaluate(() => window.sessionStorage.getItem("attend-customer-session"))).toBeNull();
  const sessionCookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith("attend_customer_"));
  expect(sessionCookies).toHaveLength(2);
  expect(sessionCookies.every((cookie) => cookie.httpOnly)).toBe(true);
  expect(sessionCookies.every((cookie) => cookie.domain === "127.0.0.1")).toBe(true);

  await page.reload();
  await expect(page.getByText("SIGNED IN")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await page.getByRole("button", { name: /Reports & Finance/ }).click();
  await expect(page.getByRole("link", { name: "Revenue Reports" })).toBeHidden();
  await page.getByRole("button", { name: /Reports & Finance/ }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Revenue Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports & finance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenue Reports" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Team Access" }).click();
  await expect(page.getByRole("heading", { name: "Role access" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});
