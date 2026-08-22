const assert = require("node:assert/strict");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/cinema-date-time.ts");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { cinemaDateTimeInputInstant, cinemaDateTimeInputValue } = helperModule.exports;

describe("cinema-local date-time inputs", () => {
  it("formats instants and parses inputs in the cinema timezone", () => {
    assert.equal(cinemaDateTimeInputValue("2026-08-18T13:30:00.000Z", "America/Chicago"), "2026-08-18T08:30");
    assert.equal(cinemaDateTimeInputInstant("2026-08-18T08:30", "America/Chicago"), "2026-08-18T13:30:00.000Z");
  });

  it("rejects nonexistent spring-forward times", () => {
    assert.throws(
      () => cinemaDateTimeInputInstant("2026-03-08T02:30", "America/Chicago"),
      /does not exist/,
    );
  });

  it("resolves repeated fall-back times deterministically", () => {
    assert.equal(cinemaDateTimeInputInstant("2026-11-01T01:30", "America/Chicago"), "2026-11-01T06:30:00.000Z");
  });
});
