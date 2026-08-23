const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const page = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");
const ticketService = readFileSync(resolve(__dirname, "../app/ticket-service.tsx"), "utf8");
const formatter = readFileSync(resolve(__dirname, "../app/cinema-date-time.ts"), "utf8");

test("staff showtimes use the authenticated cinema timezone", () => {
  assert.match(page, /formatCinemaTime\(showtime\.startsAt, employee\.timezone\)/);
  assert.match(page, /timeZone=\{employee\.timezone\}/);
  assert.match(formatter, /toLocaleTimeString\([\s\S]*timeZone/);
});

test("ticket search, exchanges, and reprints share cinema-local formatting", () => {
  assert.equal((ticketService.match(/formatCinemaDateTime\([^,]+, timeZone\)/g) ?? []).length, 3);
  assert.doesNotMatch(ticketService, /new Date\([^)]*startsAt\)\.toLocaleString/);
  assert.match(formatter, /toLocaleString\(\[\], \{ timeZone \}\)/);
});
