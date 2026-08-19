const assert = require("node:assert/strict");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/report-range.ts");
const dashboardPath = resolve(__dirname, "../app/management-dashboard.tsx");
const expensesPath = resolve(__dirname, "../app/expenses/page.tsx");
const controlsPath = resolve(__dirname, "../app/management-controls.tsx");
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { inclusiveDateCutoff, inclusiveReportRange, localDateInputValue } = helperModule.exports;

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

  it("includes the final millisecond in a selected cutoff date", () => {
    const cutoff = new Date(inclusiveDateCutoff("2026-08-18"));
    const nextDay = new Date(inclusiveReportRange("2026-08-18", "2026-08-18").to);

    assert.equal(nextDay.getTime() - cutoff.getTime(), 1);
    assert.equal(localDateInputValue(cutoff), "2026-08-18");
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

  it("uses the inclusive cutoff for win-back customer previews", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");

    assert.match(dashboard, /inclusiveDateCutoff\(inactiveSince\)/);
    assert.doesNotMatch(dashboard, /T23:59:59/);
  });

  it("keeps expense defaults local and uses the shared inclusive range", () => {
    const expenses = readFileSync(expensesPath, "utf8");

    assert.match(expenses, /localDateInputValue\(today\)/);
    assert.match(expenses, /new URLSearchParams\(inclusiveReportRange\(from, through\)\)/);
    assert.doesNotMatch(expenses, /toISOString\(\)\.slice\(0, 10\)/);
    assert.doesNotMatch(expenses, /const nextDay/);
  });

  it("keeps refund-history defaults local and includes the selected end date", () => {
    const controls = readFileSync(controlsPath, "utf8");

    assert.match(controls, /localDateInputValue\(new Date\(\)\)/);
    assert.match(controls, /inclusiveReportRange\(historyFrom, historyTo\)/);
    assert.doesNotMatch(controls, /historyTo[\s\S]{0,100}toISOString\(\)\.slice\(0, 10\)/);
    assert.doesNotMatch(controls, /new Date\(`\$\{historyTo\}T00:00:00`\)/);
  });
});
