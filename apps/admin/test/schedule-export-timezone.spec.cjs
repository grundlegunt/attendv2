const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/schedule-export.ts"), "utf8");
const calendar = readFileSync(join(__dirname, "../app/scheduling-calendar.tsx"), "utf8");

test("schedule workbooks use cinema-local days and time labels", () => {
  assert.match(source, /timeZone: string/);
  assert.match(source, /cinemaDateTimeInputInstant/);
  assert.match(source, /startOfCinemaDay\(dateKey, timeZone\)/);
  assert.match(source, /formatTime\(new Date\(showtime\.startsAt\), timeZone\)/);
  assert.doesNotMatch(source, /date\.setHours\(START_HOUR/);
  assert.doesNotMatch(source, /timeCell\.value = slotStart/);
  assert.match(calendar, /downloadScheduleWorkbook\(\{ locationName, timeZone, selectedDate/);
});
