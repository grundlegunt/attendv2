import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";

const api = process.env.LOAD_API_URL ?? "http://127.0.0.1:4000/api/v1";
const email = process.env.LOAD_STAFF_EMAIL ?? "owner@ridgelinecinema.test";
const password = process.env.LOAD_STAFF_PASSWORD ?? "DevPassword123!";
const ownerMfaSecret = process.env.LOAD_STAFF_MFA_SECRET ?? "AAAAAAAAAAAAAAAA";
const showtimeIds = (process.env.LOAD_SHOWTIME_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const ticketTypeId = process.env.LOAD_TICKET_TYPE_ID;
const ordersPerAuditorium = Number(process.env.LOAD_RESTAURANT_ORDERS_PER_AUDITORIUM ?? 30);
const ticketSalesP95BudgetMs = Number(process.env.LOAD_TICKET_SALES_P95_BUDGET_MS ?? 2_500);
const restaurantP95BudgetMs = Number(process.env.LOAD_RESTAURANT_P95_BUDGET_MS ?? 2_500);

if (showtimeIds.length !== 3 || !ticketTypeId) {
  throw new Error("Set LOAD_SHOWTIME_IDS to exactly three comma-separated showtime IDs and LOAD_TICKET_TYPE_ID to an active ticket type.");
}

const timings = { setup: [], ticketSales: [], restaurant: [] };
async function call(path, init = {}, category = "setup") {
  const started = performance.now();
  const response = await fetch(`${api}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  timings[category].push(performance.now() - started);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

const login = await call("/auth/staff/login", { method: "POST", body: JSON.stringify({ email, password }) });
const session = login.mfaRequired
  ? await call("/auth/staff/mfa/verify", { method: "POST", body: JSON.stringify({ challengeToken: login.challengeToken, code: authenticator.generate(ownerMfaSecret) }) })
  : login;
const auth = { authorization: `Bearer ${session.accessToken}` };
const drawers = await Promise.all(showtimeIds.map((_, index) => call("/box-office/cash-drawers", { method: "POST", headers: auth, body: JSON.stringify({ registerId: `opening-night-${index + 1}-${randomUUID()}`, openingBalanceCents: 0 }) })));
const menu = await call("/restaurant-menu", { headers: auth });
const menuItem = menu.categories.flatMap((category) => category.items).find((item) => !item.is86d);
if (!menuItem) throw new Error("The load fixture needs at least one active, available menu item.");
const modifierIds = menuItem.modifierGroups.filter((group) => group.required).map((group) => group.modifiers[0]?.id).filter(Boolean);

const sellouts = await Promise.all(showtimeIds.map(async (showtimeId, auditoriumIndex) => {
  const availability = await call(`/cinema/showtimes/${showtimeId}/seats`, {}, "ticketSales");
  const available = availability.seats.filter((seat) => seat.state === "AVAILABLE");
  const groups = Array.from({ length: Math.ceil(available.length / 10) }, (_, index) => available.slice(index * 10, index * 10 + 10));
  const sales = await Promise.all(groups.map(async (seats) => {
    const holderKey = `opening-night-${randomUUID()}`;
    const holds = await call(`/box-office/showtimes/${showtimeId}/holds`, { method: "POST", headers: auth, body: JSON.stringify({ holderKey, seatIds: seats.map((seat) => seat.id) }) }, "ticketSales");
    const holdTokens = holds.map((hold) => hold.holdToken);
    const quote = await call("/box-office/quotes", { method: "POST", headers: auth, body: JSON.stringify({ holderKey, holdTokens }) }, "ticketSales");
    return call("/box-office/checkouts", { method: "POST", headers: auth, body: JSON.stringify({ requestId: randomUUID(), ticketTypeId, holderKey, holdTokens, cashDrawerId: drawers[auditoriumIndex].id, cashCents: quote.totalCents, cardCents: 0, cashReceivedCents: quote.totalCents }) }, "ticketSales");
  }));
  const after = await call(`/cinema/showtimes/${showtimeId}/seats`, {}, "ticketSales");
  const counts = after.seats.reduce((totals, seat) => {
    totals[seat.state] = (totals[seat.state] ?? 0) + 1;
    return totals;
  }, {});
  if ((counts.SOLD ?? 0) !== available.length || (counts.HELD ?? 0) !== 0 || (counts.AVAILABLE ?? 0) !== 0) {
    throw new Error(`Sellout invariant failed for ${showtimeId}: ${JSON.stringify(counts)}`);
  }
  const issued = sales.reduce((sum, sale) => sum + sale.tickets.length, 0);
  if (issued !== available.length) throw new Error(`Ticket count mismatch for ${showtimeId}: expected ${available.length}, got ${issued}`);
  return { showtimeId, seatsSold: issued };
}));

const restaurantBursts = await Promise.all(showtimeIds.map(async (showtimeId, auditoriumIndex) => {
  const sent = await Promise.all(Array.from({ length: ordersPerAuditorium }, async (_, orderIndex) => {
    const tab = await call("/restaurant-tabs/walk-in", { method: "POST", headers: auth, body: JSON.stringify({ label: `Load A${auditoriumIndex + 1}-${orderIndex + 1}-${showtimeId.slice(0, 6)}` }) }, "restaurant");
    const order = await call(`/restaurant-tabs/${tab.id}/orders`, { method: "POST", headers: auth, body: "{}" }, "restaurant");
    await call(`/restaurant-tabs/orders/${order.id}/items`, { method: "POST", headers: auth, body: JSON.stringify({ menuItemId: menuItem.id, quantity: 2, modifierIds }) }, "restaurant");
    return call(`/restaurant-tabs/orders/${order.id}/send`, { method: "POST", headers: auth, body: "{}" }, "restaurant");
  }));
  if (sent.some((order) => order.status !== "SENT")) throw new Error(`Restaurant order invariant failed for auditorium ${auditoriumIndex + 1}.`);
  return { auditorium: auditoriumIndex + 1, ordersSent: sent.length };
}));

function summarize(samples, budgetMs) {
  const sorted = samples.toSorted((a, b) => a - b);
  return { requests: samples.length, p95Ms: Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0), budgetMs };
}

const performanceSummary = {
  setup: summarize(timings.setup, null),
  ticketSales: summarize(timings.ticketSales, ticketSalesP95BudgetMs),
  restaurant: summarize(timings.restaurant, restaurantP95BudgetMs),
};
if (performanceSummary.ticketSales.p95Ms > ticketSalesP95BudgetMs) throw new Error(`Ticket-sales p95 ${performanceSummary.ticketSales.p95Ms}ms exceeded ${ticketSalesP95BudgetMs}ms budget.`);
if (performanceSummary.restaurant.p95Ms > restaurantP95BudgetMs) throw new Error(`Restaurant p95 ${performanceSummary.restaurant.p95Ms}ms exceeded ${restaurantP95BudgetMs}ms budget.`);
console.log(JSON.stringify({ result: "PASS", performance: performanceSummary, sellouts, restaurantBursts }, null, 2));
