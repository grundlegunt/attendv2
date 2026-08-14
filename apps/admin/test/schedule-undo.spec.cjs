const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/schedule-undo.ts");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { captureShowtimeMoves } = helperModule.exports;

describe("schedule move undo", () => {
  it("captures the original room and start time for every moved showtime", () => {
    const showtimes = [
      { id: "show-1", startsAt: "2026-08-17T18:00:00.000Z", auditorium: { id: "room-1" } },
      { id: "show-2", startsAt: "2026-08-17T20:30:00.000Z", auditorium: { id: "room-2" } },
    ];

    assert.deepEqual(captureShowtimeMoves(showtimes), [
      { showtimeId: "show-1", auditoriumId: "room-1", startsAt: "2026-08-17T18:00:00.000Z" },
      { showtimeId: "show-2", auditoriumId: "room-2", startsAt: "2026-08-17T20:30:00.000Z" },
    ]);
  });

  it("returns an empty undo payload when no showtimes moved", () => {
    assert.deepEqual(captureShowtimeMoves([]), []);
  });
});
