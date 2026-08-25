const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const navigationPath = resolve(__dirname, "../app/admin-navigation.ts");
const adminSessionSource = readFileSync(resolve(__dirname, "../app/admin-session.tsx"), "utf8");
const adminNavSource = readFileSync(resolve(__dirname, "../app/admin-nav.tsx"), "utf8");
const dashboardSource = readFileSync(resolve(__dirname, "../app/admin-dashboard.tsx"), "utf8");
const schedulingSource = readFileSync(resolve(__dirname, "../app/scheduling/page.tsx"), "utf8");
const filmLibrarySource = readFileSync(resolve(__dirname, "../app/films/page.tsx"), "utf8");
const membershipsSource = readFileSync(resolve(__dirname, "../app/memberships/page.tsx"), "utf8");
const merchSource = readFileSync(resolve(__dirname, "../app/merch/page.tsx"), "utf8");
const globalStylesSource = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
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

const operationalSitesPath = resolve(__dirname, "../app/lib/operational-sites.ts");
const operationalSitesSource = readFileSync(operationalSitesPath, "utf8");
const operationalSitesCompiled = ts.transpileModule(operationalSitesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: operationalSitesPath,
});
const operationalSitesModule = new Module(operationalSitesPath, module);
operationalSitesModule.filename = operationalSitesPath;
operationalSitesModule.paths = module.paths;
operationalSitesModule._compile(operationalSitesCompiled.outputText, operationalSitesPath);
const { operationalSites, visibleOperationalSites } = operationalSitesModule.exports;

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
    assert.deepEqual(complete.map((item) => item.href), ["/", "/scheduling", "/films", "/film-series", "/cinema-setup"]);
  });

  it("exposes a standalone searchable film library with performance drilldowns", () => {
    assert.match(filmLibrarySource, /apiFetch<Bootstrap>\("\/cinema\/admin\/bootstrap"/);
    assert.match(filmLibrarySource, /placeholder="Title, director, or distributor"/);
    assert.match(filmLibrarySource, /`\/films\/\$\{encodeURIComponent\(movie\.id\)\}`/);
    assert.match(filmLibrarySource, /Archived films/);
  });

  it("supports any-of permission destinations without widening other sections", () => {
    const links = visibleAdminNavigation(["menu.edit"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/", "/taxes", "/menu"]);
  });

  it("puts the permission-gated Staff POS link inside F&B without treating it as an internal quick action", () => {
    const links = visibleAdminNavigation(["seat.sell"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.label), ["Dashboard", "POS"]);
    assert.equal(links[1].external, true);
    assert.match(adminNavSource, /item\.external/);
    assert.match(adminNavSource, /target="_blank"/);
    assert.match(dashboardSource, /item\.href !== "\/" && !item\.external/);
  });

  it("offers Labor from both financial reporting and team management", () => {
    const groups = visibleAdminNavigation(["reports.view"]);
    assert.deepEqual(groups.filter((group) => group.items.some((item) => item.href === "/labor")).map((group) => group.label), ["Financial Reports", "Team"]);
  });

  it("exposes a searchable external-membership directory linked to customer profiles", () => {
    const links = visibleAdminNavigation(["ticket.price.edit"]).flatMap((group) => group.items);
    assert.equal(links.some((item) => item.href === "/memberships"), true);
    assert.match(membershipsSource, /\/management\/memberships/);
    assert.match(membershipsSource, /`\/customers\/\$\{membership\.customer\.id\}`/);
    assert.match(membershipsSource, /All statuses/);
  });

  it("keeps the external merchandise shop editor discoverable under Extras", () => {
    const extras = adminNavigation.find((group) => group.label === "Extras");
    assert.equal(extras.items.some((item) => item.href === "/merch" && item.label === "Merch"), true);
    assert.match(merchSource, /section="merch"/);
  });

  it("shows distributor and financial reporting tools only with financial reporting permission", () => {
    const links = visibleAdminNavigation(["reports.view.financial"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/", "/distributors", "/reports", "/expenses"]);
  });

  it("does not expose financial operations without payment-refund permission", () => {
    const links = visibleAdminNavigation(["ticket.refund"]).flatMap((group) => group.items);
    assert.deepEqual(links.map((item) => item.href), ["/"]);
    assert.equal(links.some((item) => item.href === "/gift-cards"), false);
    const managerLinks = visibleAdminNavigation(["payment.refund"]).flatMap((group) => group.items);
    assert.deepEqual(managerLinks.map((item) => item.href), ["/", "/search", "/refunds", "/gift-cards"]);
    const fullManagerLinks = visibleAdminNavigation(["payment.refund", "reports.view"]).flatMap((group) => group.items);
    assert.equal(fullManagerLinks.some((item) => item.href === "/attention"), true);
  });
});

describe("operational app links", () => {
  it("uses the deployed apps as safe defaults", () => {
    assert.deepEqual(operationalSites.map((site) => site.href), [
      "https://attend-staff-pos.vercel.app",
      "https://attendv2-kds.vercel.app",
    ]);
  });

  it("only exposes apps the employee can operate", () => {
    assert.deepEqual(visibleOperationalSites([]), []);
    assert.deepEqual(visibleOperationalSites(["seat.sell"]).map((site) => site.label), ["Open Staff POS"]);
    assert.deepEqual(visibleOperationalSites(["kitchen.status.update"]).map((site) => site.label), ["Open kitchen display"]);
  });
});

describe("film editor layout", () => {
  it("uses a large centered workspace without widening every scheduling drawer", () => {
    assert.match(schedulingSource, /className="editor-backdrop movie-editor-backdrop"/);
    assert.match(schedulingSource, /className="showtime-drawer movie-editor-modal"/);
    assert.match(globalStylesSource, /\.movie-editor-modal \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(globalStylesSource, /\.movie-editor-modal \{[^}]*width: min\(1100px, 100%\)/);
    assert.match(globalStylesSource, /\.showtime-drawer \{[^}]*460px/);
  });
});

describe("historical showtime inventory", () => {
  it("uses the authenticated Admin inventory route instead of public availability", () => {
    assert.match(schedulingSource, /`\/cinema\/admin\/showtimes\/\$\{editingShowtimeId\}\/seats`/);
    assert.match(schedulingSource, /\{ accessToken: token \}/);
    assert.doesNotMatch(schedulingSource, /`\/cinema\/showtimes\/\$\{editingShowtimeId\}\/seats`/);
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

  it("serializes validation and publishing before React updates the buttons", () => {
    assert.match(schedulingSource, /const planActionPendingRef = useRef\(false\)/);
    assert.match(schedulingSource, /async function validateSchedulePlan[\s\S]*?if \(planActionPendingRef\.current \|\| planShowtimeMutationRef\.current\) return;\s*planActionPendingRef\.current = true/);
    assert.match(schedulingSource, /async function makeSchedulePlanLive[\s\S]*?if \(planActionPendingRef\.current \|\| planShowtimeMutationRef\.current\) return;\s*planActionPendingRef\.current = true/);
    assert.match(schedulingSource, /finally \{\s*planActionPendingRef\.current = false;\s*setPublishingPlan\(false\)/);
  });

  it("locks weekly plan saves before React updates the form", () => {
    assert.match(schedulingSource, /const savingPlanRef = useRef\(false\)/);
    assert.match(schedulingSource, /async function saveSchedulePlan[\s\S]*?if \(savingPlanRef\.current \|\| deletingPlanRef\.current \|\| managingPlanRef\.current \|\| planShowtimeMutationRef\.current\) return;\s*savingPlanRef\.current = true/);
    assert.match(schedulingSource, /finally \{\s*savingPlanRef\.current = false;\s*setSavingPlan\(false\)/);
  });

  it("locks destructive plan deletion against saves and repeat clicks", () => {
    assert.match(schedulingSource, /const deletingPlanRef = useRef\(false\)/);
    assert.match(schedulingSource, /async function deleteSchedulePlan[\s\S]*?if \(savingPlanRef\.current \|\| deletingPlanRef\.current \|\| managingPlanRef\.current \|\| planShowtimeMutationRef\.current\) return/);
    assert.match(schedulingSource, /deletingPlanRef\.current = true;\s*setDeletingPlanId\(plan\.id\)/);
    assert.match(schedulingSource, /deletingPlanId === plan\.id \? "Deleting…" : "Delete"/);
  });

  it("serializes plan duplicate and rename operations", () => {
    assert.match(schedulingSource, /const managingPlanRef = useRef\(false\)/);
    assert.match(schedulingSource, /async function duplicateSchedulePlan[\s\S]*?managingPlanRef\.current = true;\s*setManagingPlan\(\{ id: plan\.id, action: "duplicate" \}\)/);
    assert.match(schedulingSource, /async function renameSchedulePlan[\s\S]*?managingPlanRef\.current = true;\s*setManagingPlan\(\{ id: plan\.id, action: "rename" \}\)/);
    assert.match(schedulingSource, /managingPlan\.action === "duplicate" \? "Duplicating…"/);
    assert.match(schedulingSource, /managingPlan\.action === "rename" \? "Renaming…"/);
  });

  it("serializes showtime edits inside a saved plan", () => {
    assert.match(schedulingSource, /const planShowtimeMutationRef = useRef\(false\)/);
    assert.match(schedulingSource, /setPlanShowtimeMutation\(\{ index: null, action: "add" \}\)/);
    assert.match(schedulingSource, /setPlanShowtimeMutation\(\{ index, action: "change" \}\)/);
    assert.match(schedulingSource, /setPlanShowtimeMutation\(\{ index, action: "remove" \}\)/);
    assert.match(schedulingSource, /if \(planActionPendingRef\.current \|\| planShowtimeMutationRef\.current\) return/);
    assert.match(schedulingSource, /planShowtimeMutation\.action === "remove" \? "Removing…"/);
  });
});

describe("showtime inspector layout", () => {
  it("contains the seat map and form controls within their grid columns", () => {
    assert.match(
      globalStylesSource,
      /\.schedule-inspector \.showtime-inspector-summary \{[^}]*min-width: 0;/,
    );
    assert.match(
      globalStylesSource,
      /\.schedule-inspector \.showtime-inspector-fields \{[^}]*min-width: 0;/,
    );
    assert.match(
      globalStylesSource,
      /\.showtime-seat-inventory \{[^}]*grid-column: 1 \/ -1;[^}]*min-width: 0;/,
    );
    assert.match(
      globalStylesSource,
      /\.showtime-inspector-fields input, \.showtime-inspector-fields select \{[^}]*width: 100%;[^}]*min-width: 0;/,
    );
  });
});
