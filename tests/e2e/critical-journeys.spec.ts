import { expect, test } from "@playwright/test";

const password = "DevPassword123!";

test("customer sees the published dining experience and accessible menu", async ({ page }) => {
  await page.route("**/api/v1/cinema/menu", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { id: "location-1", name: "Meridian Cinema", address: null },
        menuPresentation: {
          assetUrl: "https://example.com/current-menu.jpg",
          assetType: "IMAGE",
        },
        categories: [{
          id: "category-1",
          name: "Shareables",
          items: [{
            id: "item-1",
            name: "Shoestring Fries",
            description: "Rosemary chive aioli and ketchup",
            imageUrl: null,
            priceCents: 800,
            isVegan: true,
            isGlutenFree: false,
          }],
        }],
        movieSpecials: [{
          movieId: "movie-1",
          movieTitle: "Spider-Man: Brand New Day",
          posterUrl: null,
          artworkUrl: null,
          headline: "Spidey Supper",
          items: [{
            id: "special-1",
            name: "Spidey Dog",
            description: "A special available only with this film",
            imageUrl: "https://example.com/spidey-dog.jpg",
            priceCents: 900,
            isVegan: false,
            isGlutenFree: false,
          }],
        }],
      }),
    });
  });

  await page.goto("http://127.0.0.1:3000/dining-bar");

  await expect(page.getByRole("heading", { name: "Dining & Bar" })).toBeVisible();
  await expect(page.locator('a[href="/afterglow"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movie Specials" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spider-Man: Brand New Day" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Spidey Dog" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Current food and drink menu" })).toBeVisible();

  await page.getByText("Browse accessible text menu").click();
  await expect(page.getByRole("heading", { name: "Shareables" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shoestring Fries" })).toBeVisible();
  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shoestring Fries" })).toBeVisible();
});

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
  const continueToTickets = page.getByRole("button", { name: "Continue to tickets" });
  await expect(continueToTickets).toBeEnabled();
  await continueToTickets.click();

  const authorizeDining = page.getByRole("radio", { name: "Yes, save and authorize this card" });
  const paySeparately = page.getByRole("radio", { name: "No, I’ll pay separately" });
  const continueToPayment = page.getByRole("button", { name: "Continue to payment" });
  await expect(authorizeDining).not.toBeChecked();
  await expect(paySeparately).not.toBeChecked();
  await expect(continueToPayment).toBeDisabled();

  await paySeparately.check();
  await expect(paySeparately).toBeChecked();
  await expect(authorizeDining).not.toBeChecked();
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

test("signed-in customer details carry into ticket checkout", async ({ page }) => {
  const login = await page.request.post("http://127.0.0.1:3000/api/v1/auth/customers/login", {
    data: { email: "customer@ridgelinecinema.test", password },
  });
  expect(login.status()).toBe(200);

  await page.goto("http://127.0.0.1:3000");
  const showtime = page.locator(".program-tile__showtimes button:not([disabled])").first();
  const showtimeDates = page.getByRole("navigation", { name: "Showtime dates" }).getByRole("button");
  for (let index = 0; index < await showtimeDates.count() && await showtime.count() === 0; index += 1) {
    await showtimeDates.nth(index).click();
  }
  await showtime.click();
  const seatMap = page.getByRole("region", { name: /seating chart/i });
  await seatMap.locator("button:not([disabled])").first().click();
  await page.getByRole("button", { name: "Continue to tickets" }).click();

  await expect(page.getByText("Using your signed-in account details.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Casey Customer");
  await expect(page.getByLabel("Email")).toHaveValue("customer@ridgelinecinema.test");
});

test("guest checkout details carry into account registration", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/showtimes");
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "attend-account-handoff",
      JSON.stringify({ email: "new.moviegoer@example.com", name: "New Moviegoer" }),
    );
  });

  await page.goto("http://127.0.0.1:3000/account?createAccount=1");

  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("New Moviegoer");
  await expect(page.getByLabel("Email")).toHaveValue("new.moviegoer@example.com");
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("attend-account-handoff")),
  ).toBeNull();
});

test("restaurant payment recovery link shows the remaining balance without retrying automatically", async ({ page }) => {
  let paymentRequests = 0;
  await page.route("**/api/v1/public/restaurant-tabs/recovery-token**", async (route) => {
    if (route.request().method() === "POST") paymentRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "tab-recovery",
        status: "PAYMENT_FAILED",
        checkDroppedAt: "2026-08-13T18:00:00.000Z",
        selectedTipCents: 200,
        activePaymentMethod: { id: "payment-method-1", brand: "visa", last4: "4242" },
        orders: [{
          id: "order-1",
          items: [{
            id: "item-1",
            quantity: 1,
            unitPriceCentsSnapshot: 1700,
            modifierTotalCents: 0,
            menuItem: { name: "Dinner special" },
          }],
        }],
        totals: {
          subtotalCents: 1700,
          taxCents: 166,
          serviceChargeCents: 200,
          totalCents: 2066,
        },
        paidCents: 0,
        receipt: null,
      }),
    });
  });

  await page.goto("http://127.0.0.1:3000/account?restaurantTab=recovery-token");

  await expect(page.getByRole("heading", { name: "Your live tab" })).toBeVisible();
  await expect(page.getByText("Your previous payment attempt was not completed. No automatic retry was made."))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Balance due $20.66" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry remaining balance" })).toBeVisible();
  expect(paymentRequests).toBe(0);
});

test("staff signs in, clocks in, and reaches live operational tools", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001");
  await page.getByLabel("Email").fill("owner@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();
  const staffSession = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("attend-staff-pos-session") ?? "null"));
  expect(staffSession).toEqual(expect.objectContaining({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresInSeconds: expect.any(Number) }));
  await page.reload();
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible();
  await page.getByLabel("Employee PIN").fill("1234");
  await page.getByRole("button", { name: "Enter POS" }).click();
  await expect(page.getByRole("navigation", { name: "Staff tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan tickets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Box office" })).toBeVisible();
});

test("kitchen display restores its authenticated station session", async ({ page }) => {
  await page.goto("http://127.0.0.1:3002");
  await page.getByLabel("Email").fill("owner@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Station")).toBeVisible();
  const kdsSession = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("attend-kds-session") ?? "null"));
  expect(kdsSession).toEqual(expect.objectContaining({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresInSeconds: expect.any(Number) }));
  await page.reload();
  await expect(page.getByLabel("Station")).toBeVisible();
});

test("manager signs in and reaches reporting and configuration", async ({ page }) => {
  await page.goto("http://127.0.0.1:3003");
  await page.getByLabel("Email").fill("owner@ridgelinecinema.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const adminSession = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("attend-admin-session") ?? "null"));
  expect(adminSession).toEqual(expect.objectContaining({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresInSeconds: expect.any(Number) }));
  await page.reload();
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
  const mobileSidebar = page.getByRole("complementary", { name: "Admin navigation" });
  await mobileSidebar.getByRole("button", { name: "Close navigation" }).click();
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

test("Attend operator signs in and navigates to Clients", async ({ page }) => {
  await page.goto("http://127.0.0.1:3004");
  await page.getByLabel("Email").fill("platform@attend.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Platform health" })).toBeVisible();
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Client operations" })).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
});
