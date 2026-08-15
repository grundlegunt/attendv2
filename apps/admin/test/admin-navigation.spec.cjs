const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const navigationPath = resolve(__dirname, "../app/admin-navigation.ts");
const adminSessionSource = readFileSync(resolve(__dirname, "../app/admin-session.tsx"), "utf8");
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

  it("does not expose financial operations without payment-refund permission", () => {
    const links = visibleAdminNavigation(["ticket.refund"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/"]);
    assert.equal(links.some((item) => item.href === "/gift-cards"), false);
    const managerLinks = visibleAdminNavigation(["payment.refund"]).flatMap((group) => group.items);
    assert.deepEqual(managerLinks.map((item) => item.href), ["/", "/refunds", "/gift-cards"]);
  });
});
