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
const originalRequire = helperModule.require.bind(helperModule);
helperModule.require = (request) => {
  if (request !== "@cinema/shared") return originalRequire(request);
  return {
    startOfCalendarDay(dateKey, timeZone) {
      const [year, month, day] = dateKey.split("-").map(Number);
      const target = Date.UTC(year, month - 1, day);
      let candidate = target;
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23",
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]));
        candidate = target - (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - candidate);
      }
      return new Date(candidate);
    },
  };
};
helperModule._compile(compiled.outputText, helperPath);
const { inclusiveDateCutoff, inclusiveReportRange, localDateInputValue } = helperModule.exports;

describe("Admin report date ranges", () => {
  it("includes the entire selected end date", () => {
    const range = inclusiveReportRange("2026-08-18", "2026-08-18", "America/Chicago");
    const start = new Date(range.from);
    const end = new Date(range.to);

    assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
    assert.equal(range.from, "2026-08-18T05:00:00.000Z");
    assert.equal(range.to, "2026-08-19T05:00:00.000Z");
    assert.equal(localDateInputValue(start, "America/Chicago"), "2026-08-18");
    assert.equal(localDateInputValue(new Date(end.getTime() - 1), "America/Chicago"), "2026-08-18");
  });

  it("allows multi-day ranges and rejects reversed dates", () => {
    const range = inclusiveReportRange("2026-08-17", "2026-08-19", "America/Chicago");
    assert.equal(localDateInputValue(new Date(range.from), "America/Chicago"), "2026-08-17");
    assert.equal(localDateInputValue(new Date(new Date(range.to).getTime() - 1), "America/Chicago"), "2026-08-19");
    assert.throws(() => inclusiveReportRange("2026-08-20", "2026-08-19", "America/Chicago"));
  });

  it("honors daylight-saving day lengths in the cinema timezone", () => {
    const spring = inclusiveReportRange("2026-03-08", "2026-03-08", "America/Chicago");
    const fall = inclusiveReportRange("2026-11-01", "2026-11-01", "America/Chicago");
    assert.equal(Date.parse(spring.to) - Date.parse(spring.from), 23 * 60 * 60 * 1000);
    assert.equal(Date.parse(fall.to) - Date.parse(fall.from), 25 * 60 * 60 * 1000);
  });

  it("includes the final millisecond in a selected cutoff date", () => {
    const cutoff = new Date(inclusiveDateCutoff("2026-08-18", "America/Chicago"));
    const nextDay = new Date(inclusiveReportRange("2026-08-18", "2026-08-18", "America/Chicago").to);

    assert.equal(nextDay.getTime() - cutoff.getTime(), 1);
    assert.equal(localDateInputValue(cutoff, "America/Chicago"), "2026-08-18");
  });

  it("uses the inclusive range for every management CSV export", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");
    const exportEndpoints = ["labor.csv", "revenue.csv", "distributor-box-office.csv"];

    for (const endpoint of exportEndpoints) {
      assert.ok(
        dashboard.includes(`${endpoint}?\${new URLSearchParams(inclusiveReportRange(from, to, timeZone)).toString()}`),
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

    assert.match(dashboard, /inclusiveDateCutoff\(inactiveSince, timeZone\)/);
    assert.doesNotMatch(dashboard, /T23:59:59/);
  });

  it("keeps expense defaults in the cinema timezone and uses the shared inclusive range", () => {
    const expenses = readFileSync(expensesPath, "utf8");

    assert.match(expenses, /localDateInputValue\(today, timeZone\)/);
    assert.match(expenses, /new URLSearchParams\(inclusiveReportRange\(from, through, timeZone\)\)/);
    assert.match(expenses, /Date\.parse\(incurredRange\.from\).*Date\.parse\(incurredRange\.to\)/);
    assert.doesNotMatch(expenses, /toISOString\(\)\.slice\(0, 10\)/);
    assert.doesNotMatch(expenses, /const nextDay/);
  });

  it("keeps refund-history defaults in the cinema timezone and includes the selected end date", () => {
    const controls = readFileSync(controlsPath, "utf8");

    assert.match(controls, /localDateInputValue\(new Date\(\), timeZone\)/);
    assert.match(controls, /inclusiveReportRange\(historyFrom, historyTo, timeZone\)/);
    assert.doesNotMatch(controls, /historyTo[\s\S]{0,100}toISOString\(\)\.slice\(0, 10\)/);
    assert.doesNotMatch(controls, /new Date\(`\$\{historyTo\}T00:00:00`\)/);
  });

  it("renders management timestamps and expense dates in the cinema timezone", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");
    const expenses = readFileSync(expensesPath, "utf8");

    assert.match(dashboard, /const cinemaDate = .*toLocaleDateString\(\[\], \{ timeZone \}\)/);
    assert.match(dashboard, /const cinemaDateTime = .*toLocaleString\(\[\], \{ timeZone \}\)/);
    assert.match(dashboard, /cinemaDateTime\(row\.startsAt, timeZone\)/);
    assert.match(dashboard, /cinemaDateTime\(row\.clockInAt, timeZone\)/);
    assert.match(dashboard, /cinemaDate\(customer\.lastPurchaseAt, timeZone\)/);
    assert.match(dashboard, /cinemaDateTime\(event\.occurredAt, timeZone\)/);
    assert.match(expenses, /toLocaleDateString\(\[\], \{ timeZone \}\)/);
  });
});
