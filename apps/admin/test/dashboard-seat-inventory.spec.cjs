const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/admin-dashboard.tsx"), "utf8");

test("dashboard seat previews serialize requests and cancel them on teardown", () => {
  assert.match(source, /if \(inventory \|\| inventoryRequestRef\.current\) return/);
  assert.match(source, /inventoryRequestRef\.current = controller/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /inventoryRequestRef\.current\?\.abort\(\)/);
});

test("dashboard seat previews use authenticated historical inventory", () => {
  const adminInventoryRequests = source.match(/`\/cinema\/admin\/showtimes\/\$\{showtime\.id\}\/seats`/g) ?? [];
  assert.equal(adminInventoryRequests.length, 2);
  assert.doesNotMatch(source, /`\/cinema\/showtimes\/\$\{showtime\.id\}\/seats`/);
});

test("dashboard seat previews allow retry after a transient failure", () => {
  assert.doesNotMatch(source, /if \(inventory \|\| inventoryLoading \|\| inventoryError\) return/);
  assert.match(source, /setInventoryError\(false\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) setInventoryError\(true\)/);
});

test("top films preview the closest showing and link to their revenue row", () => {
  assert.match(source, /closestShowtimeByMovie/);
  assert.match(source, /className="dashboard-seat-preview top-film-seat-preview"/);
  assert.match(source, /href=\{`\/reports#movie-\$\{encodeURIComponent\(film\.movieId\)\}`\}/);
  assert.match(source, /onMouseEnter=\{loadInventory\}/);
});

test("dashboard calendar ranges use the cinema timezone instead of the browser timezone", () => {
  assert.match(source, /timezone: string/);
  assert.match(source, /startOfLocalDay\(date, timeZone\)/);
  assert.match(source, /dayRange\(locationTimeZone, 0, now\)/);
  assert.match(source, /scheduleRange\(scheduleDay, locationTimeZone, now\)/);
  assert.doesNotMatch(source, /from\.setHours\(0, 0, 0, 0\)/);
});

test("dashboard waits for cinema timezone before loading date-bound reports", () => {
  assert.match(source, /if \(!canFinancial \|\| \(canCinema && !bootstrap\)\) return/);
  assert.match(source, /if \(!canFinancial \|\| !canCinema \|\| !bootstrap\) return/);
  assert.doesNotMatch(source, /key: "bootstrap" \| "revenue"/);
  assert.doesNotMatch(source, /canSettings, locationTimeZone\]\)/);
});

test("started showtimes are not presented as active low-sales screenings", () => {
  assert.match(source, /const hasStarted = new Date\(showtime\.startsAt\)\.getTime\(\) <= now/);
  assert.match(source, /hasStarted\s*\? "sales-normal"/);
  assert.match(source, /<em>\{hasStarted \? "Started"/);
});

test("daily schedule does not silently omit later showtimes", () => {
  assert.match(source, /scheduleShowtimes\.map\(\(showtime\) =>/);
  assert.doesNotMatch(source, /scheduleShowtimes\.slice\(/);
});

test("dashboard time-sensitive status and reports advance without a reload", () => {
  assert.match(source, /window\.setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\)/);
  assert.match(source, /return \(\) => window\.clearInterval\(timer\)/);
  assert.match(source, /const locationDayStart = localDayStart\(now, locationTimeZone\)\.toISOString\(\)/);
  assert.match(source, /locationDayStart, locationTimeZone/);
  assert.match(source, /new Date\(showtime\.startsAt\)\.getTime\(\) <= now/);
});

test("dashboard date and time labels use the cinema timezone", () => {
  assert.match(source, /toLocaleTimeString\(\[\], \{ hour: "numeric", minute: "2-digit", timeZone \}\)/);
  assert.match(source, /toLocaleString\(\[\], \{ timeZone \}\)/);
  assert.match(source, /timeZone: locationTimeZone/);
  assert.match(source, /event\.occurredAt\)\.toLocaleDateString\(\[\], \{ month: "short", day: "numeric", timeZone: locationTimeZone \}\)/);
  assert.doesNotMatch(source, /new Date\(\)\.toLocaleDateString/);
});
