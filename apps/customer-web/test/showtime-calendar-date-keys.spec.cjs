const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const calendar = readFileSync(resolve(__dirname, "../app/components/showtime-calendar.tsx"), "utf8");
const showtimes = readFileSync(resolve(__dirname, "../app/showtimes/page.tsx"), "utf8");

test("the full showtime calendar performs date-only math in UTC", () => {
  assert.match(calendar, /T00:00:00Z/);
  assert.match(calendar, /Date\.UTC/);
  assert.match(calendar, /getUTCFullYear/);
  assert.match(calendar, /getUTCMonth/);
  assert.match(calendar, /getUTCDate/);
  assert.doesNotMatch(calendar, /getFullYear\(|getMonth\(|getDate\(/);
});

test("showtime date-strip labels cannot shift with the visitor timezone", () => {
  assert.match(showtimes, /new Date\(`\$\{dateKey\}T00:00:00Z`\)/);
  assert.equal((showtimes.match(/timeZone: "UTC"/g) ?? []).length, 2);
});
