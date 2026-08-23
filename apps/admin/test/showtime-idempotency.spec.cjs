const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("showtime creation retains stable retry identities", () => {
  assert.match(source, /showtimeAttemptRef = useRef/);
  assert.match(source, /movieAttemptRef = useRef/);
  assert.match(source, /updateMovieAttemptRef = useRef/);
  assert.match(source, /archiveMovieAttemptRef = useRef/);
  assert.match(source, /restoreMovieAttemptRef = useRef/);
  assert.match(source, /deleteMovieAttemptRef = useRef/);
  assert.match(source, /updateShowtimeAttemptRef = useRef/);
  assert.match(source, /saleStatusAttemptRef = useRef/);
  assert.match(source, /quickShowtimeAttemptRef = useRef/);
  assert.match(source, /duplicateDayAttemptRef = useRef/);
  assert.match(source, /removeShowtimeAttemptRef = useRef/);
  assert.match(source, /moveShowtimeAttemptRef = useRef/);
  assert.match(source, /groupMoveAttemptRef = useRef/);
  assert.match(source, /undoMoveAttemptRef = useRef/);
  assert.match(source, /schedulePlanAttemptRef = useRef/);
  assert.match(source, /duplicatePlanAttemptRef = useRef/);
  assert.match(source, /addPlanShowtimeAttemptRef = useRef/);
  assert.match(source, /removePlanShowtimeAttemptRef = useRef/);
  assert.match(source, /updatePlanShowtimeAttemptRef = useRef/);
  assert.match(source, /renamePlanAttemptRef = useRef/);
  assert.match(source, /deletePlanAttemptRef = useRef/);
  assert.match(source, /publishPlanAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": showtimeAttemptRef\.current!/);
  assert.match(source, /"Idempotency-Key": movieAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": updateMovieAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": archiveMovieAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": restoreMovieAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": deleteMovieAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": updateShowtimeAttemptRef\.current!/);
  assert.match(source, /"Idempotency-Key": saleStatusAttemptRef\.current\.requestId/);
  assert.match(source, /"If-Unmodified-Since": editingShowtimeUpdatedAt/);
  assert.match(source, /"Idempotency-Key": quickShowtimeAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": duplicateDayAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": removeShowtimeAttemptRef\.current!\.requestId/);
  assert.match(source, /"Idempotency-Key": moveShowtimeAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": groupMoveAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": undoMoveAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": schedulePlanAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": duplicatePlanAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": addPlanShowtimeAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": removePlanShowtimeAttemptRef\.current!\.requestId/);
  assert.match(source, /"Idempotency-Key": updatePlanShowtimeAttemptRef\.current!\.requestId/);
  assert.match(source, /"Idempotency-Key": renamePlanAttemptRef\.current!\.requestId/);
  assert.match(source, /"Idempotency-Key": deletePlanAttemptRef\.current!\.requestId/);
  assert.match(source, /"Idempotency-Key": publishPlanAttemptRef\.current!\.requestId/);
});

test("showtime editor reads and writes times in the cinema timezone", () => {
  assert.match(source, /const timeZone = employee\?\.timezone \?\? "UTC"/);
  assert.match(source, /startsAtInstant = cinemaDateTimeInputInstant\(startsAt, timeZone\)/);
  assert.match(source, /setStartsAt\(cinemaDateTimeInputValue\(showtime\.startsAt, timeZone\)\)/);
  assert.match(source, /cinemaDateTimeInputInstant\(planShowtimeStartsAt, timeZone\)/);
  assert.match(source, /timeZone,\n\s+\}\);/);
  assert.doesNotMatch(source, /startsAt: new Date\(startsAt\)\.toISOString\(\)/);
});

test("showtime editor mutations share an immediate action lock", () => {
  assert.match(source, /showtimeEditorActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(showtimeEditorActionRef\.current(?: \|\| calendarShortcutActionRef\.current)?\) return;/g)?.length, 3);
  assert.equal(source.match(/showtimeEditorActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/showtimeEditorActionRef\.current = false;/g)?.length, 3);
  assert.match(source, /setShowtimeEditorAction\("save"\)/);
  assert.match(source, /setShowtimeEditorAction\("sale"\)/);
  assert.match(source, /setShowtimeEditorAction\("remove"\)/);
});

test("calendar shortcuts serialize with showtime editor mutations", () => {
  assert.match(source, /calendarShortcutActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(calendarShortcutActionRef\.current \|\| showtimeEditorActionRef\.current\) return;/g)?.length, 3);
  assert.equal(source.match(/calendarShortcutActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/calendarShortcutActionRef\.current = false;/g)?.length, 3);
  assert.equal(source.match(/if \(showtimeEditorActionRef\.current \|\| calendarShortcutActionRef\.current\) return;/g)?.length, 3);
});

test("single, group, and undo moves share an immediate action lock", () => {
  assert.match(source, /scheduleMoveActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(scheduleMoveActionRef\.current\) return;/g)?.length, 2);
  assert.match(source, /if \(!undoMoves\?\.length \|\| scheduleMoveActionRef\.current\) return;/);
  assert.equal(source.match(/scheduleMoveActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/scheduleMoveActionRef\.current = false;/g)?.length, 3);
});

test("film library mutations share an immediate action lock", () => {
  assert.match(source, /movieActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(movieActionRef\.current\) return;/g)?.length, 4);
  assert.equal(source.match(/movieActionRef\.current = true;/g)?.length, 4);
  assert.equal(source.match(/movieActionRef\.current = false;/g)?.length, 4);
  assert.match(source, /setMovieAction\("save"\)/);
  assert.match(source, /setMovieAction\("archive"\)/);
  assert.match(source, /setMovieAction\("restore"\)/);
  assert.match(source, /setMovieAction\("delete"\)/);
});
