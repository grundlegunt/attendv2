const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const calendar = readFileSync(
  join(__dirname, "../app/scheduling-calendar.tsx"),
  "utf8",
);
const page = readFileSync(join(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("scheduling calendar derives days and labels from the cinema timezone", () => {
  assert.match(calendar, /timeZone: string/);
  assert.match(calendar, /cinemaDateTimeInputInstant/);
  assert.match(calendar, /cinemaDateTimeInputValue/);
  assert.match(calendar, /cinemaDayStart\(selectedDate, timeZone\)/);
  assert.match(calendar, /cinemaDateKey\(new Date\(\), timeZone\)/);
  assert.match(calendar, /addDateKey\(selectedDate, index\)/);
  assert.match(calendar, /formatTime\(showtime\.startsAt, timeZone\)/);
  assert.doesNotMatch(calendar, /getTimezoneOffset\(\)/);
  assert.doesNotMatch(calendar, /new Date\(`\$\{selectedDate\}T12:00:00`\)/);
  assert.match(page, /timeZone=\{timeZone\}/);
});
