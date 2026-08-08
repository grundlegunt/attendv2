import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminNavigation, isAdminItemActive, visibleAdminNavigation } from "../app/admin-navigation.ts";

describe("admin navigation", () => {
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

  it("does not expose the refund workbench without its read permission", () => {
    const links = visibleAdminNavigation(["ticket.refund"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/"]);
    const managerLinks = visibleAdminNavigation(["payment.refund"]).flatMap((group) => group.items);
    assert.deepEqual(managerLinks.map((item) => item.href), ["/", "/refunds"]);
  });
});
