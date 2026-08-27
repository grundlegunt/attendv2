"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
interface Session { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } }
interface Overview { organizations: Array<{ id: string; name: string }> }
interface ContentLocation { id: string; name: string; active: boolean; content: { draft: unknown; published: unknown; publishedAt: string | null } }
interface OrganizationContent { id: string; name: string; locations: ContentLocation[] }

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }
function csvCell(value: string | boolean) { return `"${String(value).replaceAll('"', '""')}"`; }

export default function ContentStudioDashboard() {
  const [session, setSession] = useState<Session | null>(null); const [restored, setRestored] = useState(false); const [organizations, setOrganizations] = useState<OrganizationContent[]>([]); const [query, setQuery] = useState(""); const [contentFilter, setContentFilter] = useState("ALL");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const authRequestRef = useRef(0);
  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then((overview) => Promise.all(overview.organizations.map((organization) => request<OrganizationContent>(`/platform/organizations/${organization.id}`, undefined, session.accessToken))))
      .then((nextOrganizations) => { if (active) setOrganizations(nextOrganizations); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load Content Studio."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]);
  const rows = useMemo(() => organizations
    .flatMap((organization) => organization.locations.map((location) => ({ organization, location, draftChanges: JSON.stringify(location.content.draft) !== JSON.stringify(location.content.published) })))
    .filter(({ organization, location, draftChanges }) => {
      const matchesQuery = `${organization.name} ${location.name}`.toLowerCase().includes(query.toLowerCase().trim());
      const matchesStatus = contentFilter === "ALL"
        || (contentFilter === "DRAFT" && draftChanges)
        || (contentFilter === "NEVER" && !location.content.publishedAt)
        || (contentFilter === "CURRENT" && !draftChanges && Boolean(location.content.publishedAt));
      return matchesQuery && matchesStatus;
    })
    .sort((left, right) => Number(right.draftChanges) - Number(left.draftChanges) || left.organization.name.localeCompare(right.organization.name) || left.location.name.localeCompare(right.location.name)), [contentFilter, organizations, query]);
  function exportContentStatus() {
    const headers = ["Client", "Location", "Location active", "Content status", "Last published"];
    const exportRows = rows.map(({ organization, location, draftChanges }) => [
      organization.name,
      location.name,
      location.active,
      draftChanges ? "Unpublished changes" : location.content.publishedAt ? "Published" : "Never published",
      location.content.publishedAt ?? "",
    ]);
    const csv = [headers, ...exportRows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ringo-master-content-status-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function login(event: FormEvent) { event.preventDefault(); const requestId = ++authRequestRef.current; setError(null); try { const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); if (requestId !== authRequestRef.current) return; window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  function signOut() { authRequestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOrganizations([]); setError(null); }
  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;
  return <main className="shell"><header><div><p className="eyebrow platform-master-label" /><h1>Content Studio</h1><p className="muted">Manage customer-site copy while keeping drafts private until publication.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header><PlatformNav role={session.user.role} />{error && <div className="error">{error}</div>}<div className="content-toolbar"><label>Find client or location<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Content Studio" /></label><label>Publication status<select value={contentFilter} onChange={(event) => setContentFilter(event.target.value)}><option value="ALL">All content</option><option value="DRAFT">Unpublished changes</option><option value="NEVER">Never published</option><option value="CURRENT">Published and current</option></select></label><div><strong>{rows.filter((row) => row.draftChanges).length}</strong><span>drafts in this view</span></div><button className="quiet" type="button" disabled={loading || rows.length === 0} onClick={exportContentStatus}>Export CSV</button></div><section className="content-studio-list">{loading && <p className="muted">Loading content status…</p>}{!loading && rows.length === 0 && <p className="empty-state">No cinema locations match these filters.</p>}{rows.map(({ organization, location, draftChanges }) => <article key={location.id}><div><p className="eyebrow">{organization.name}</p><h2>{location.name}</h2><span className={location.active ? "status good" : "status warning"}>{location.active ? "Active location" : "Inactive location"}</span></div><div><span className={draftChanges ? "status warning" : "status good"}>{draftChanges ? "Unpublished changes" : "Published"}</span><small>{location.content.publishedAt ? `Last published ${new Date(location.content.publishedAt).toLocaleString()}` : "Never published"}</small></div><Link className="link-button" href={`/clients?organizationId=${encodeURIComponent(organization.id)}&locationId=${encodeURIComponent(location.id)}&section=content`}>{session.user.role === "VIEWER" ? "View content" : draftChanges ? "Review draft" : "Edit content"}</Link></article>)}</section></main>;
}
