const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/lib/tax-rate.ts");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);

const { formatPermillePercentage, percentageToPermille } = helperModule.exports;

describe("tax rate percentage input", () => {
  it("converts customer-facing percentages to stored permille", () => {
    assert.equal(percentageToPermille("9.8"), 98);
    assert.equal(percentageToPermille("9.75"), 97.5);
    assert.equal(percentageToPermille("6.25"), 62.5);
    assert.equal(percentageToPermille("0"), 0);
    assert.equal(formatPermillePercentage(97.5), "9.75");
  });

  it("rejects invalid and implausible percentages", () => {
    assert.throws(() => percentageToPermille(""));
    assert.throws(() => percentageToPermille("-1"));
    assert.throws(() => percentageToPermille("100.1"));
    assert.throws(() => percentageToPermille("9.755"));
    assert.throws(() => percentageToPermille("not-a-rate"));
  });
});
