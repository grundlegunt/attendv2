const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const dashboard = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");
const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");

test("Master aggregates sold tickets by canonical film across operators", () => {
  assert.match(platform, /const key = showtime\.movie\.catalogEntryId \?\? showtime\.movie\.id/);
  assert.match(platform, /organizationIds: new Set<string>/);
  assert.match(platform, /showtimeIds: new Set<string>/);
  assert.match(platform, /ticketRevenueCents \+= ticket\.priceCentsPaid/);
  assert.match(platform, /status: \{ notIn: \["REFUNDED", "CANCELED"\] \}/);
});

test("Master dashboard shows the cross-cinema film leaderboard for its selected range", () => {
  assert.match(dashboard, /Top films across cinemas/);
  assert.match(dashboard, /Performance dates follow the selected revenue range/);
  assert.match(dashboard, /film\.operators/);
  assert.match(dashboard, /film\.showtimes/);
  assert.match(dashboard, /film\.ticketRevenueCents/);
  assert.match(dashboard, /href=\{`\/films\/\$\{encodeURIComponent\(film\.catalogEntryId\)\}`\}/);
});

test("Master dashboard supports custom inclusive reporting dates", () => {
  assert.match(dashboard, /type RevenueRange = [\s\S]*?\| "custom"/);
  assert.match(dashboard, /`\$\{customFrom\}T00:00:00\.000Z`/);
  assert.match(dashboard, /`\$\{customTo\}T23:59:59\.999Z`/);
  assert.match(dashboard, /customFrom > customTo/);
  assert.match(dashboard, /<button className=\{revenueRangeKey === "custom"/);
  assert.match(dashboard, /type="date" value=\{customFrom\}/);
  assert.match(dashboard, /type="date" value=\{customTo\}/);
  assert.match(dashboard, /revenueRange\(revenueRangeKey, customFrom, customTo, "csv"\)/);
});
