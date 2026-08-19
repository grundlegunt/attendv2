const assert = require("node:assert/strict");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/report-range.ts");
const dashboardPath = resolve(__dirname, "../app/management-dashboard.tsx");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { inclusiveReportRange, localDateInputValue } = helperModule.exports;

describe("Admin report date ranges", () => {
  it("includes the entire selected end date", () => {
    const range = inclusiveReportRange("2026-08-18", "2026-08-18");
    const start = new Date(range.from);
    const end = new Date(range.to);

    assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
    assert.equal(localDateInputValue(start), "2026-08-18");
    assert.equal(localDateInputValue(new Date(end.getTime() - 1)), "2026-08-18");
  });

  it("allows multi-day ranges and rejects reversed dates", () => {
    const range = inclusiveReportRange("2026-08-17", "2026-08-19");
    assert.equal(localDateInputValue(new Date(range.from)), "2026-08-17");
    assert.equal(localDateInputValue(new Date(new Date(range.to).getTime() - 1)), "2026-08-19");
    assert.throws(() => inclusiveReportRange("2026-08-20", "2026-08-19"));
  });

  it("uses the inclusive range for every management CSV export", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");
    const exportEndpoints = ["labor.csv", "revenue.csv", "distributor-box-office.csv"];

    for (const endpoint of exportEndpoints) {
      assert.ok(
        dashboard.includes(`${endpoint}?\${new URLSearchParams(inclusiveReportRange(from, to)).toString()}`),
        `${endpoint} must use the shared inclusive report range`,
      );
    }
  });

  it("uses the authenticated download client and reports export failures", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");

    assert.match(dashboard, /import \{ apiDownload, apiFetch, ApiRequestError \}/);
    assert.match(dashboard, /const blob = await apiDownload\(path, \{ accessToken \}\)/);
    assert.match(dashboard, /reason instanceof ApiRequestError \? reason\.body\.message : fallbackMessage/);
    assert.doesNotMatch(dashboard, /await fetch\(`/);
  });
});
