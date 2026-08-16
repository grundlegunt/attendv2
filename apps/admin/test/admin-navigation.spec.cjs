const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const navigationPath = resolve(__dirname, "../app/admin-navigation.ts");
const adminSessionSource = readFileSync(resolve(__dirname, "../app/admin-session.tsx"), "utf8");
const schedulingSource = readFileSync(resolve(__dirname, "../app/scheduling/page.tsx"), "utf8");
const source = readFileSync(navigationPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: navigationPath,
});
const navigationModule = new Module(navigationPath, module);
navigationModule.filename = navigationPath;
navigationModule.paths = module.paths;
navigationModule._compile(compiled.outputText, navigationPath);
const { adminNavigation, isAdminItemActive, visibleAdminNavigation } = navigationModule.exports;

const auditoriumLayoutPath = resolve(__dirname, "../app/auditorium-layout.ts");
const auditoriumLayoutSource = readFileSync(auditoriumLayoutPath, "utf8");
const auditoriumLayoutCompiled = ts.transpileModule(auditoriumLayoutSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: auditoriumLayoutPath,
});
const auditoriumLayoutModule = new Module(auditoriumLayoutPath, module);
auditoriumLayoutModule.filename = auditoriumLayoutPath;
auditoriumLayoutModule.paths = module.paths;
auditoriumLayoutModule._compile(auditoriumLayoutCompiled.outputText, auditoriumLayoutPath);
const { normalizeSeatTableMetadata, replaceSeatTypeAtCoordinate } = auditoriumLayoutModule.exports;

describe("admin navigation", () => {
  it("keeps the signed-out identity fixed to Attend instead of client branding", () => {
    const signedOutStart = adminSessionSource.indexOf("if (!value)");
    const passwordChangeStart = adminSessionSource.indexOf("if (value.employee.mustChangePassword)");
    const signedOutMarkup = adminSessionSource.slice(signedOutStart, passwordChangeStart);

    assert.match(signedOutMarkup, /login-monogram/);
    assert.match(signedOutMarkup, /ATTEND ADMIN/);
    assert.match(signedOutMarkup, /<h1>Cinema operations<\/h1>/);
    assert.doesNotMatch(signedOutMarkup, /publicBranding\?\.logoUrl/);
    assert.doesNotMatch(signedOutMarkup, /publicBranding\?\.name/);
  });

  it("keeps Dashboard first and active only at the admin root", () => {
    assert.deepEqual(adminNavigation[0]?.items[0], { href: "/", label: "Dashboard", permissions: [] });
    assert.equal(isAdminItemActive("/", "/"), true);
    assert.equal(isAdminItemActive("/reports", "/"), false);
    assert.equal(isAdminItemActive("/reports/detail", "/reports"), true);
  });

  it("shows only destinations backed by the employee's permissions", () => {
    const links = visibleAdminNavigation(["audit.log.view"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/", "/audit-log"]);
    assert.equal(links.some((item) => item.href === "/users"), false);
    assert.equal(links.some((item) => item.href === "/scheduling"), false);
  });

  it("requires the complete cinema bootstrap permission set", () => {
    const incomplete = visibleAdminNavigation(["movie.manage", "showtime.manage"]).flatMap((group) => group.items);
    assert.deepEqual(incomplete.map((item) => item.href), ["/"]);

    const complete = visibleAdminNavigation(["auditorium.manage", "movie.manage", "showtime.manage"]).flatMap((group) => group.items);
    assert.deepEqual(complete.map((item) => item.href), ["/", "/scheduling", "/film-series", "/cinema-setup"]);
  });

  it("supports any-of permission destinations without widening other sections", () => {
    const links = visibleAdminNavigation(["menu.edit"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/", "/menu", "/taxes"]);
  });

  it("shows the expense ledger only with financial reporting permission", () => {
    const links = visibleAdminNavigation(["reports.view.financial"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/", "/reports", "/expenses"]);
  });

  it("does not expose financial operations without payment-refund permission", () => {
    const links = visibleAdminNavigation(["ticket.refund"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/"]);
    assert.equal(links.some((item) => item.href === "/gift-cards"), false);
    const managerLinks = visibleAdminNavigation(["payment.refund"]).flatMap((group) => group.items);
    assert.deepEqual(managerLinks.map((item) => item.href), ["/", "/refunds", "/gift-cards"]);
  });
});

describe("auditorium layout editing", () => {
  it("preserves table metadata when an existing seat becomes ADA", () => {
    const seats = [
      { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD", levelKey: "main", tableGroupId: "A-1", tablePosition: "LEFT" },
      { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD", levelKey: "main", tableGroupId: "A-1", tablePosition: "RIGHT" },
    ];

    const updated = replaceSeatTypeAtCoordinate(seats, "main", 0, 0, "ADA");

    assert.equal(updated.length, 2);
    assert.deepEqual(updated[0], { ...seats[0], type: "ADA" });
    assert.deepEqual(updated[1], seats[1]);
  });

  it("adds a new sellable position when the grid cell is empty", () => {
    const updated = replaceSeatTypeAtCoordinate([], "main", 4, 2, "COMPANION");

    assert.equal(updated.length, 1);
    assert.equal(updated[0].type, "COMPANION");
    assert.equal(updated[0].levelKey, "main");
    assert.equal(updated[0].x, 4);
    assert.equal(updated[0].y, 2);
  });

  it("removes stale table pairing from single-seat layouts", () => {
    const seats = [
      { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "ADA", levelKey: "main", tableGroupId: "A-1", tablePosition: "LEFT" },
      { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "COMPANION", levelKey: "main", tableGroupId: "A-1", tablePosition: "RIGHT" },
    ];

    const normalized = normalizeSeatTableMetadata(seats, "SINGLE");

    assert.deepEqual(normalized, seats.map(({ tableGroupId: _group, tablePosition: _position, ...seat }) => seat));
  });

  it("preserves pairing metadata for actual two-seat table layouts", () => {
    const seats = [
      { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD", levelKey: "main", tableGroupId: "A-1", tablePosition: "LEFT" },
      { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD", levelKey: "main", tableGroupId: "A-1", tablePosition: "RIGHT" },
    ];

    assert.equal(normalizeSeatTableMetadata(seats, "TABLE_2"), seats);
  });
});

describe("saved schedule publishing", () => {
  it("offers one clear action that validates immediately before making a plan live", () => {
    assert.match(schedulingSource, /async function makeSchedulePlanLive/);
    assert.match(schedulingSource, /"Make live"/);
    assert.match(schedulingSource, /expectedUpdatedAt: validation\.expectedUpdatedAt/);
    assert.doesNotMatch(schedulingSource, />Publish saved plan</);
  });
});
