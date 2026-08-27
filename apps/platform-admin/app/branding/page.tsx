"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";
import { PlatformBrandEditor } from "./platform-brand-editor";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
interface Session {
  accessToken: string;
  user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" };
}
interface Overview {
  organizations: Array<{ id: string; name: string }>;
}
interface Palette {
  logoUrl?: string | null;
  accentColor: string | null;
  accentMutedColor: string | null;
  backgroundColor: string | null;
  surfaceColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
}
interface BrandLocation {
  id: string;
  name: string;
  active: boolean;
  branding: Palette;
  adminBranding: Palette;
  brandingDraft: { draftedAt: string | null } | null;
}
interface OrganizationBranding {
  id: string;
  name: string;
  locations: BrandLocation[];
}
function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }
function csvCell(value: string | number | boolean) { return `"${String(value).replaceAll('"', '""')}"`; }
const colors = (palette: Palette) =>
  [
    palette.accentColor,
    palette.accentMutedColor,
    palette.backgroundColor,
    palette.surfaceColor,
    palette.textColor,
    palette.mutedTextColor,
  ].filter((color): color is string => Boolean(color));

export default function BrandingDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationBranding[]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const authRequestRef = useRef(0);
  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then((overview) =>
        Promise.all(
          overview.organizations.map((organization) =>
            request<OrganizationBranding>(
              `/platform/organizations/${organization.id}`,
              undefined,
              session.accessToken,
            ),
          ),
        ),
      )
      .then((nextOrganizations) => { if (active) setOrganizations(nextOrganizations); })
      .catch((reason: unknown) =>
        active && setError(
          reason instanceof Error ? reason.message : "Could not load branding.",
        ),
      )
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]);
  const rows = useMemo(
    () =>
      organizations
        .flatMap((organization) =>
          organization.locations.map((location) => ({
            organization,
            location,
            configured:
              colors(location.branding).length > 0 ||
              Boolean(location.branding.logoUrl),
          })),
        )
        .filter(({ organization, location, configured }) => {
          const matchesQuery = `${organization.name} ${location.name}`
            .toLowerCase()
            .includes(query.toLowerCase().trim());
          const matchesStatus = brandFilter === "ALL"
            || (brandFilter === "DRAFT" && Boolean(location.brandingDraft))
            || (brandFilter === "NEEDED" && !configured)
            || (brandFilter === "PUBLISHED" && configured && !location.brandingDraft);
          return matchesQuery && matchesStatus;
        })
        .sort(
          (left, right) =>
            Number(left.configured) - Number(right.configured) ||
            left.organization.name.localeCompare(right.organization.name) ||
            left.location.name.localeCompare(right.location.name),
        ),
    [brandFilter, organizations, query],
  );
  function exportBrandReadiness() {
    const headers = ["Client", "Location", "Location active", "Brand status", "Customer colors", "Admin colors", "Customer logo", "Drafted at"];
    const exportRows = rows.map(({ organization, location, configured }) => [
      organization.name,
      location.name,
      location.active,
      location.brandingDraft ? "Unpublished draft" : configured ? "Published" : "Setup needed",
      colors(location.branding).length,
      colors(location.adminBranding).length,
      Boolean(location.branding.logoUrl),
      location.brandingDraft?.draftedAt ?? "",
    ]);
    const csv = [headers, ...exportRows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ringo-master-brand-readiness-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    const requestId = ++authRequestRef.current;
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (requestId !== authRequestRef.current) return;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) {
      if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed.");
    }
  }
  function signOut() {
    authRequestRef.current += 1;
    void revokePlatformSession(API_BASE_URL, session?.accessToken);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setOrganizations([]);
    setError(null);
  }
  if (!restored)
    return (
      <main className="center">
        <p>Loading Ringo Master…</p>
      </main>
    );
  if (!session)
    return (
      <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />
    );
  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow platform-master-label" />
          <h1>Branding</h1>
          <p className="muted">
            Review customer and cinema-admin identities across every location.
          </p>
        </div>
        <div className="identity">
          <span>{session.user.name}</span>
          <button className="quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <PlatformNav role={session.user.role} />
      {error && <div className="error">{error}</div>}
      <PlatformBrandEditor accessToken={session.accessToken} canEdit={session.user.role !== "VIEWER"} request={request} />
      <div className="content-toolbar">
        <label>
          Find client or location
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search branding"
          />
        </label>
        <label>
          Brand status
          <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
            <option value="ALL">All branding</option>
            <option value="DRAFT">Unpublished drafts</option>
            <option value="NEEDED">Setup needed</option>
            <option value="PUBLISHED">Published</option>
          </select>
        </label>
        <div>
          <strong>{rows.filter((row) => row.location.brandingDraft).length}</strong>
          <span>drafts in this view</span>
        </div>
        <button className="quiet" type="button" disabled={loading || rows.length === 0} onClick={exportBrandReadiness}>Export CSV</button>
      </div>
      <section className="branding-list">
        {loading && <p className="muted">Loading brand identities…</p>}
        {!loading && rows.length === 0 && (
          <p className="empty-state">No cinema locations match these filters.</p>
        )}
        {rows.map(({ organization, location, configured }) => (
          <article key={location.id}>
            <div>
              <p className="eyebrow">{organization.name}</p>
              <h2>{location.name}</h2>
              <span className={configured ? "status good" : "status warning"}>
                {location.brandingDraft ? "Unpublished draft" : configured ? "Published" : "Setup needed"}
              </span>
            </div>
            <div className="brand-preview">
              <span>
                <small>Customer site</small>
                <i>
                  {colors(location.branding).map((color, index) => (
                    <b
                      key={`${color}-${index}`}
                      style={{ background: color }}
                    />
                  ))}
                </i>
              </span>
              <span>
                <small>Cinema admin</small>
                <i>
                  {colors(location.adminBranding).map((color, index) => (
                    <b
                      key={`${color}-${index}`}
                      style={{ background: color }}
                    />
                  ))}
                </i>
              </span>
            </div>
            <Link
              className="link-button"
              href={`/clients?organizationId=${encodeURIComponent(organization.id)}&locationId=${encodeURIComponent(location.id)}&section=branding`}
            >
              {location.brandingDraft ? "Review draft" : "Edit branding"}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
