"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminUiDefaults, type AdminUiConfig, type CinemaContent } from "@cinema/shared";
import { AdminUiEditor } from "./admin-ui-editor";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL
  ?? (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const CINEMA_ADMIN_URL = process.env.NEXT_PUBLIC_CINEMA_ADMIN_URL ?? "http://localhost:3003";
const CUSTOMER_WEB_URL = process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL ?? "http://localhost:3000";
const STORAGE_KEY = "attend-platform-session";
const RECOMMENDED_ADMIN_PALETTE = {
  adminAccentColor: "#ffb800",
  adminAccentMutedColor: "#8a6500",
  adminBackgroundColor: "#000000",
  adminSurfaceColor: "#1b1b1b",
  adminTextColor: "#ffffff",
  adminMutedTextColor: "#cccccc",
} as const;

interface PlatformUser { id: string; name: string; email: string }
interface Session { accessToken: string; user: PlatformUser }
interface LocationOverview {
  id: string; name: string; address: string | null; timezone: string; active: boolean;
  configuration: { branding: boolean; auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number };
}
interface OrganizationOverview {
  id: string; name: string; legalName: string | null; timezone: string;
  payments: { connected: boolean; onboardingStatus: string };
  locations: LocationOverview[];
}
interface Overview { generatedAt: string; organizations: OrganizationOverview[] }
type BrandPalette = { accentColor: string | null; accentMutedColor: string | null; backgroundColor: string | null; backgroundGlowColor: string | null; surfaceColor: string | null; textColor: string | null; mutedTextColor: string | null };
interface OrganizationDetail {
  id: string; name: string; legalName: string | null; timezone: string; createdAt: string;
  payments: { connected: boolean; onboardingStatus: string };
  locations: Array<{
    id: string; name: string; address: string | null; timezone: string; currency: string; active: boolean;
    branding: BrandPalette & { logoUrl: string | null };
    adminBranding: BrandPalette & { ui: AdminUiConfig };
    content: { draft: CinemaContent; published: CinemaContent; publishedAt: string | null };
    operations: { ticketTaxRateBasisPoints: number; preShowBufferMinutes: number; cleaningBufferMinutes: number; checkDropMinutesBeforeEnd: number; autoSettleGraceMinutes: number; timeClockEnabled: boolean };
    configuration: { auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number; activeMovies: number; activeFilmSeries: number };
  }>;
}
type OrganizationDraft = { name: string; legalName: string; timezone: string; onboardingStatus: string };
type OrganizationCreateDraft = { name: string; legalName: string; timezone: string; locationName: string; address: string; locationTimezone: string };
type CinemaManagerDraft = { locationId: string; name: string; email: string; password: string };
type LocationDetail = OrganizationDetail["locations"][number];
type LocationDraft = {
  name: string; address: string; timezone: string; active: boolean; logoUrl: string;
  accentColor: string; accentMutedColor: string; backgroundColor: string; backgroundGlowColor: string; surfaceColor: string; textColor: string; mutedTextColor: string;
  adminAccentColor: string; adminAccentMutedColor: string; adminBackgroundColor: string; adminSurfaceColor: string; adminTextColor: string; adminMutedTextColor: string;
  adminUi: AdminUiConfig;
  ticketTaxRateBasisPoints: number; preShowBufferMinutes: number; cleaningBufferMinutes: number; checkDropMinutesBeforeEnd: number; autoSettleGraceMinutes: number; timeClockEnabled: boolean;
};

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(typeof body.message === "string" ? body.message : "Request failed.");
  }
  return response.json() as Promise<T>;
}

export default function AttendMaster() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft | null>(null);
  const [organizationCreateDraft, setOrganizationCreateDraft] = useState<OrganizationCreateDraft | null>(null);
  const [locationDraft, setLocationDraft] = useState<{ id: string; values: LocationDraft } | null>(null);
  const [contentDraft, setContentDraft] = useState<{ id: string; values: CinemaContent } | null>(null);
  const [cinemaManagerDraft, setCinemaManagerDraft] = useState<CinemaManagerDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setSession(JSON.parse(stored) as Session); } catch { window.sessionStorage.removeItem(STORAGE_KEY); }
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then(setOverview)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load clients."));
  }, [session]);

  useEffect(() => {
    if (!session || !selectedOrganizationId) { setOrganization(null); return; }
    setOrganizationLoading(true); setError(null);
    request<OrganizationDetail>(`/platform/organizations/${selectedOrganizationId}`, undefined, session.accessToken)
      .then(setOrganization)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load this cinema."))
      .finally(() => setOrganizationLoading(false));
  }, [selectedOrganizationId, session]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
  }

  function signOut() {
    window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOverview(null); setSelectedOrganizationId(null); setOrganization(null); setError(null);
  }

  function beginOrganizationEdit(detail: OrganizationDetail) {
    setOrganizationDraft({ name: detail.name, legalName: detail.legalName ?? "", timezone: detail.timezone, onboardingStatus: detail.payments.onboardingStatus });
  }

  function beginOrganizationCreate() {
    setOrganizationCreateDraft({ name: "", legalName: "", timezone: "America/Chicago", locationName: "", address: "", locationTimezone: "America/Chicago" });
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session || !organizationCreateDraft) return;
    setSaving(true); setError(null);
    try {
      const values = organizationCreateDraft;
      const created = await request<OrganizationDetail>("/platform/organizations", { method: "POST", body: JSON.stringify({
        name: values.name,
        legalName: values.legalName || null,
        timezone: values.timezone,
        location: { name: values.locationName, address: values.address || null, timezone: values.locationTimezone },
      }) }, session.accessToken);
      const refreshed = await request<Overview>("/platform/overview", undefined, session.accessToken);
      setOverview(refreshed); setOrganizationCreateDraft(null); setSelectedOrganizationId(created.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add organization."); }
    finally { setSaving(false); }
  }

  function beginLocationEdit(location: LocationDetail) {
    setLocationDraft({ id: location.id, values: {
      name: location.name, address: location.address ?? "", timezone: location.timezone, active: location.active, logoUrl: location.branding.logoUrl ?? "",
      accentColor: location.branding.accentColor ?? "", accentMutedColor: location.branding.accentMutedColor ?? "", backgroundColor: location.branding.backgroundColor ?? "", backgroundGlowColor: location.branding.backgroundGlowColor ?? "", surfaceColor: location.branding.surfaceColor ?? "", textColor: location.branding.textColor ?? "", mutedTextColor: location.branding.mutedTextColor ?? "",
      adminAccentColor: location.adminBranding.accentColor ?? "", adminAccentMutedColor: location.adminBranding.accentMutedColor ?? "", adminBackgroundColor: location.adminBranding.backgroundColor ?? "", adminSurfaceColor: location.adminBranding.surfaceColor ?? "", adminTextColor: location.adminBranding.textColor ?? "", adminMutedTextColor: location.adminBranding.mutedTextColor ?? "",
      adminUi: location.adminBranding.ui ?? adminUiDefaults,
      ...location.operations,
    } });
  }

  async function saveOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !organizationDraft) return;
    setSaving(true); setError(null);
    try {
      const updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, { method: "PATCH", body: JSON.stringify({ ...organizationDraft, legalName: organizationDraft.legalName || null }) }, session.accessToken);
      setOrganization(updated); setOrganizationDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save organization."); }
    finally { setSaving(false); }
  }

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !locationDraft) return;
    const values = locationDraft.values;
    const nullable = (value: string) => value || null;
    setSaving(true); setError(null);
    try {
      const payload = {
        ...values, address: nullable(values.address), logoUrl: nullable(values.logoUrl), accentColor: nullable(values.accentColor), accentMutedColor: nullable(values.accentMutedColor), backgroundColor: nullable(values.backgroundColor), backgroundGlowColor: nullable(values.backgroundGlowColor), surfaceColor: nullable(values.surfaceColor), textColor: nullable(values.textColor), mutedTextColor: nullable(values.mutedTextColor), adminAccentColor: nullable(values.adminAccentColor), adminAccentMutedColor: nullable(values.adminAccentMutedColor), adminBackgroundColor: nullable(values.adminBackgroundColor), adminSurfaceColor: nullable(values.adminSurfaceColor), adminTextColor: nullable(values.adminTextColor), adminMutedTextColor: nullable(values.adminMutedTextColor), adminUi: values.adminUi,
      };
      let updated: OrganizationDetail;
      try {
        updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}/locations/${locationDraft.id}`, { method: "PATCH", body: JSON.stringify(payload) }, session.accessToken);
      } catch (reason) {
        if (!(reason instanceof Error) || reason.message !== "Request validation failed.") throw reason;
        const legacyPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "adminUi"));
        updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}/locations/${locationDraft.id}`, { method: "PATCH", body: JSON.stringify(legacyPayload) }, session.accessToken);
      }
      setOrganization(updated); setLocationDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save location."); }
    finally { setSaving(false); }
  }

  async function saveContentDraft(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !contentDraft) return;
    setSaving(true); setError(null);
    try {
      const updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}/locations/${contentDraft.id}/content/draft`, { method: "PATCH", body: JSON.stringify(contentDraft.values) }, session.accessToken);
      setOrganization(updated); setContentDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save content draft."); }
    finally { setSaving(false); }
  }

  async function publishContent(location: LocationDetail) {
    if (!session || !organization) return;
    setSaving(true); setError(null);
    try {
      const updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}/locations/${location.id}/content/publish`, { method: "POST" }, session.accessToken);
      setOrganization(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not publish content."); }
    finally { setSaving(false); }
  }

  async function createCinemaManager(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !cinemaManagerDraft) return;
    setSaving(true); setError(null);
    try {
      await request(`/platform/organizations/${organization.id}/locations/${cinemaManagerDraft.locationId}/cinema-manager`, {
        method: "POST",
        body: JSON.stringify({ name: cinemaManagerDraft.name, email: cinemaManagerDraft.email, password: cinemaManagerDraft.password }),
      }, session.accessToken);
      const updated = await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken);
      const refreshed = await request<Overview>("/platform/overview", undefined, session.accessToken);
      setOrganization(updated); setOverview(refreshed); setCinemaManagerDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the cinema manager."); }
    finally { setSaving(false); }
  }

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) return <main className="center"><form className="login-card" onSubmit={login}>
    <p className="eyebrow">ATTEND MASTER</p><h1>Company sign in</h1>
    <p className="muted">Separate from every cinema’s staff account.</p>
    {error && <div className="error">{error}</div>}
    <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="submit">Sign in</button>
  </form></main>;

  const locations = overview?.organizations.flatMap((item) => item.locations) ?? [];
  return <main className="shell">
    <header><div><p className="eyebrow">ATTEND MASTER</p><h1>{selectedOrganizationId ? "Cinema profile" : "Client operations"}</h1><p className="muted">Company visibility across cinema clients. Cinema staff retain control of their own operations.</p></div><div className="identity">{!selectedOrganizationId && <button className="quiet" onClick={beginOrganizationCreate}>+ Add organization</button>}<span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    {error && <div className="error">{error}</div>}
    {!selectedOrganizationId && organizationCreateDraft && <form className="editor create-organization" onSubmit={createOrganization}><div className="editor-heading"><div><p className="eyebrow">NEW CLIENT</p><h2>Add organization</h2><p className="muted">Create the cinema company or chain and its first operating location. More locations can be added later.</p></div><button type="button" className="quiet" onClick={() => setOrganizationCreateDraft(null)}>Cancel</button></div><div className="form-grid"><label>Organization name<input required value={organizationCreateDraft.name} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, name: event.target.value })} /></label><label>Legal name<input value={organizationCreateDraft.legalName} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, legalName: event.target.value })} /></label><label>Organization timezone<input required value={organizationCreateDraft.timezone} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, timezone: event.target.value })} /></label><label>First cinema name<input required value={organizationCreateDraft.locationName} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, locationName: event.target.value })} /></label><label>First cinema address<input value={organizationCreateDraft.address} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, address: event.target.value })} /></label><label>Cinema timezone<input required value={organizationCreateDraft.locationTimezone} onChange={(event) => setOrganizationCreateDraft({ ...organizationCreateDraft, locationTimezone: event.target.value })} /></label></div><button disabled={saving}>{saving ? "Creating…" : "Create organization and first cinema"}</button></form>}
    {selectedOrganizationId && <section className="detail-shell">
      <button className="back" onClick={() => setSelectedOrganizationId(null)}>← All cinema clients</button>
      {organizationLoading && <p className="muted">Loading cinema profile…</p>}
      {organization && <>
        <div className="detail-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>{organization.name}</h2><p className="muted">{organization.legalName ?? "Legal name not configured"} · Client since {new Date(organization.createdAt).toLocaleDateString()}</p></div><div className="org-actions"><span className={organization.payments.connected ? "status good" : "status warning"}>{organization.payments.connected ? `Payments ${organization.payments.onboardingStatus.toLowerCase()}` : `Payments ${organization.payments.onboardingStatus.toLowerCase().replaceAll("_", " ")}`}</span><button className="edit-button" onClick={() => beginOrganizationEdit(organization)}>Edit organization</button></div></div>
        {organizationDraft && <form className="editor" onSubmit={saveOrganization}><div className="editor-heading"><div><p className="eyebrow">COMPANY SETTINGS</p><h3>Edit organization</h3></div><button type="button" className="quiet" onClick={() => setOrganizationDraft(null)}>Cancel</button></div><div className="form-grid"><label>Name<input required value={organizationDraft.name} onChange={(event) => setOrganizationDraft({ ...organizationDraft, name: event.target.value })} /></label><label>Legal name<input value={organizationDraft.legalName} onChange={(event) => setOrganizationDraft({ ...organizationDraft, legalName: event.target.value })} /></label><label>Timezone<input required value={organizationDraft.timezone} onChange={(event) => setOrganizationDraft({ ...organizationDraft, timezone: event.target.value })} /></label><label>Payment onboarding<select value={organizationDraft.onboardingStatus} onChange={(event) => setOrganizationDraft({ ...organizationDraft, onboardingStatus: event.target.value })}><option value="NOT_STARTED">Not started</option><option value="IN_PROGRESS">In progress</option><option value="RESTRICTED">Restricted</option><option value="COMPLETE">Complete</option></select></label></div><p className="form-note">Complete requires a Stripe connected account. This status does not create or alter a Stripe account.</p><button disabled={saving}>{saving ? "Saving…" : "Save organization"}</button></form>}
        {organization.locations.map((location) => <article className="location-detail" key={location.id}>
          <div className="location-detail-heading"><div><div className="location-title"><h3>{location.name}</h3><span className={location.active ? "dot active" : "dot"}>{location.active ? "Active" : "Inactive"}</span></div><p className="muted">{location.address ?? "Address not configured"} · {location.timezone}</p></div><div className="actions horizontal"><button className="edit-button" onClick={() => beginLocationEdit(location)}>Edit cinema</button><button className="edit-button" onClick={() => setContentDraft({ id: location.id, values: structuredClone(location.content.draft) })}>Content Studio</button><button className="edit-button" disabled={saving} onClick={() => void publishContent(location)}>Publish draft</button><button className="edit-button" onClick={() => setCinemaManagerDraft({ locationId: location.id, name: "", email: "", password: "" })}>Add cinema manager</button><a href={CINEMA_ADMIN_URL} target="_blank" rel="noreferrer">Open cinema admin ↗</a><a href={`${CUSTOMER_WEB_URL}?locationId=${encodeURIComponent(location.id)}`} target="_blank" rel="noreferrer">Open customer site ↗</a></div></div>
          <div className="readiness-grid branding-readiness">
            <section><p className="eyebrow">READINESS</p><div className="metric-grid"><span><b>{location.configuration.auditoriums}</b> Auditoriums</span><span><b>{location.configuration.activeMovies}</b> Active movies</span><span><b>{location.configuration.activeFilmSeries}</b> Film series</span><span><b>{location.configuration.upcomingShowtimes}</b> Upcoming shows</span><span><b>{location.configuration.menuItems}</b> Menu items</span><span><b>{location.configuration.employees}</b> Active staff</span></div></section>
            <section><p className="eyebrow">CUSTOMER BRAND</p><div className="brand-preview" style={{ background: `radial-gradient(circle at top right, ${location.branding.backgroundGlowColor ?? "#3a0f1b"}, ${location.branding.backgroundColor ?? "#090a0c"} 45%)`, color: location.branding.textColor ?? "#f5f2ea", borderColor: location.branding.accentColor ?? "#7c9cff" }}><span className="brand-mark" style={{ background: location.branding.accentColor ?? "#7c9cff" }} />{location.branding.logoUrl ? <span>Custom logo configured</span> : <span>Text identity · {location.name}</span>}</div><div className="swatches">{[["Accent", location.branding.accentColor], ["Background", location.branding.backgroundColor], ["Background glow", location.branding.backgroundGlowColor], ["Surface", location.branding.surfaceColor], ["Text", location.branding.textColor]].map(([label, color]) => <span key={label}><i style={{ background: color ?? "transparent" }} />{label}<code>{color ?? "Default"}</code></span>)}</div></section>
            <section><p className="eyebrow">ADMIN INTERFACE</p><div className="brand-preview admin-preview" style={{ background: location.adminBranding.backgroundColor ?? "#000000", color: location.adminBranding.textColor ?? "#ffffff", borderColor: location.adminBranding.accentMutedColor ?? "#8a6500" }}><span className="brand-mark" style={{ background: location.adminBranding.accentColor ?? "#ffb800" }} /><span>Attend Admin · {location.name}</span></div><div className="swatches">{[["Accent", location.adminBranding.accentColor], ["Background", location.adminBranding.backgroundColor], ["Surface", location.adminBranding.surfaceColor], ["Text", location.adminBranding.textColor]].map(([label, color]) => <span key={label}><i style={{ background: color ?? "transparent" }} />{label}<code>{color ?? "Default"}</code></span>)}</div></section>
            <section><p className="eyebrow">OPERATING SETTINGS</p><dl><div><dt>Ticket tax</dt><dd>{(location.operations.ticketTaxRateBasisPoints / 100).toFixed(2)}%</dd></div><div><dt>Pre-show buffer</dt><dd>{location.operations.preShowBufferMinutes} min</dd></div><div><dt>Cleaning buffer</dt><dd>{location.operations.cleaningBufferMinutes} min</dd></div><div><dt>Check drop</dt><dd>{location.operations.checkDropMinutesBeforeEnd} min before end</dd></div><div><dt>Auto-settle grace</dt><dd>{location.operations.autoSettleGraceMinutes} min</dd></div><div><dt>Time clock</dt><dd>{location.operations.timeClockEnabled ? "Enabled" : "Disabled"}</dd></div></dl></section>
          </div>
          {cinemaManagerDraft?.locationId === location.id && <form className="editor location-editor" onSubmit={createCinemaManager}><div className="editor-heading"><div><p className="eyebrow">CINEMA ACCESS</p><h3>Create {location.name} manager login</h3><p className="muted">This account is isolated to this cinema. Cinema Manager access does not require two-step verification.</p></div><button type="button" className="quiet" onClick={() => setCinemaManagerDraft(null)}>Cancel</button></div><div className="form-grid"><label>Name<input required value={cinemaManagerDraft.name} onChange={(event) => setCinemaManagerDraft({ ...cinemaManagerDraft, name: event.target.value })} /></label><label>Email<input type="email" required value={cinemaManagerDraft.email} onChange={(event) => setCinemaManagerDraft({ ...cinemaManagerDraft, email: event.target.value })} /></label><label>Initial password<input type="password" minLength={12} required value={cinemaManagerDraft.password} onChange={(event) => setCinemaManagerDraft({ ...cinemaManagerDraft, password: event.target.value })} /></label></div><p className="form-note">Use at least 12 characters. The password is sent once over the secure API and is stored only as a one-way hash.</p><button disabled={saving}>{saving ? "Creating…" : "Create cinema manager"}</button></form>}
          {locationDraft?.id === location.id && <form className="editor location-editor" onSubmit={saveLocation}><div className="editor-heading"><div><p className="eyebrow">PLATFORM CONFIGURATION</p><h3>Edit {location.name}</h3><p className="muted">Preview both cinema surfaces here. Saving publishes these settings immediately and records the change in the platform audit log.</p></div><button type="button" className="quiet" onClick={() => setLocationDraft(null)}>Cancel</button></div><div className="form-grid"><label>Cinema name<input required value={locationDraft.values.name} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, name: event.target.value } })} /></label><label>Address<input value={locationDraft.values.address} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, address: event.target.value } })} /></label><label>Timezone<input required value={locationDraft.values.timezone} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, timezone: event.target.value } })} /></label><label className="check"><input type="checkbox" checked={locationDraft.values.active} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, active: event.target.checked } })} /> Active cinema</label></div><h4>Customer website</h4><div className="form-grid brand-fields"><label>Logo URL<input value={locationDraft.values.logoUrl} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, logoUrl: event.target.value } })} /></label>{(["accentColor", "accentMutedColor", "backgroundColor", "backgroundGlowColor", "surfaceColor", "textColor", "mutedTextColor"] as const).map((key) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<div className="color-input"><input type="color" value={locationDraft.values[key] || "#000000"} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, [key]: event.target.value } })} /><input placeholder="#fe2c54" value={locationDraft.values[key]} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, [key]: event.target.value } })} /></div></label>)}</div><div className="live-brand-preview" style={{ background: `radial-gradient(circle at top right, ${locationDraft.values.backgroundGlowColor || "#3a0f1b"}, ${locationDraft.values.backgroundColor || "#0b0b0d"} 45%)`, color: locationDraft.values.textColor || "#f5f3ee", borderColor: locationDraft.values.accentMutedColor || "#a91d39" }}><span style={{ color: locationDraft.values.accentColor || "#fe2c54" }}>NOW PLAYING</span><strong>{locationDraft.values.name}</strong><small style={{ color: locationDraft.values.mutedTextColor || "#a8a49c" }}>Customer website preview</small></div><div className="editor-heading"><h4>Cinema admin interface</h4><button type="button" className="quiet" onClick={() => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, ...RECOMMENDED_ADMIN_PALETTE } })}>Use recommended palette</button></div><div className="form-grid brand-fields">{(["adminAccentColor", "adminAccentMutedColor", "adminBackgroundColor", "adminSurfaceColor", "adminTextColor", "adminMutedTextColor"] as const).map((key) => <label key={key}>{key.replace(/^admin/, "").replace(/([A-Z])/g, " $1").trim()}<div className="color-input"><input type="color" value={locationDraft.values[key] || "#000000"} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, [key]: event.target.value } })} /><input placeholder="#ffb800" value={locationDraft.values[key]} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, [key]: event.target.value } })} /></div></label>)}</div><div className="live-brand-preview admin-live-preview" style={{ background: locationDraft.values.adminBackgroundColor || "#000000", color: locationDraft.values.adminTextColor || "#ffffff", borderColor: locationDraft.values.adminAccentMutedColor || "#8a6500" }}><span style={{ color: locationDraft.values.adminAccentColor || "#ffb800" }}>ATTEND ADMIN</span><strong>{locationDraft.values.name}</strong><small style={{ color: locationDraft.values.adminMutedTextColor || "#cccccc" }}>Cinema staff interface preview</small></div><AdminUiEditor value={locationDraft.values.adminUi} onChange={(adminUi) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, adminUi } })} onRestore={(palette) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, adminAccentColor: palette.accentColor, adminAccentMutedColor: palette.accentMutedColor, adminBackgroundColor: palette.backgroundColor, adminSurfaceColor: palette.surfaceColor, adminTextColor: palette.textColor, adminMutedTextColor: palette.mutedTextColor, adminUi: { ...locationDraft.values.adminUi, onSaleColor: palette.onSaleColor, draftColor: palette.draftColor, pastColor: palette.pastColor } } })} /><h4>Operating settings</h4><div className="form-grid">{(["ticketTaxRateBasisPoints", "preShowBufferMinutes", "cleaningBufferMinutes", "checkDropMinutesBeforeEnd", "autoSettleGraceMinutes"] as const).map((key) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<input type="number" min="0" value={locationDraft.values[key]} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, [key]: Number(event.target.value) } })} /></label>)}<label className="check"><input type="checkbox" checked={locationDraft.values.timeClockEnabled} onChange={(event) => setLocationDraft({ ...locationDraft, values: { ...locationDraft.values, timeClockEnabled: event.target.checked } })} /> Time clock enabled</label></div><button disabled={saving}>{saving ? "Publishing…" : "Save and publish cinema settings"}</button></form>}
          {contentDraft?.id === location.id && <form className="editor location-editor" onSubmit={saveContentDraft}>
            <div className="editor-heading"><div><p className="eyebrow">CONTENT STUDIO</p><h3>Edit customer website draft</h3><p className="muted">Changes stay private until you publish. Page structure and accessibility remain protected.</p></div><button type="button" className="quiet" onClick={() => setContentDraft(null)}>Cancel</button></div>
            <h4>Typography</h4><div className="form-grid"><label>Heading style<select value={contentDraft.values.typography.headingFont} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, typography: { ...contentDraft.values.typography, headingFont: event.target.value as CinemaContent["typography"]["headingFont"] } } })}><option value="EDITORIAL">Editorial serif</option><option value="CLASSIC">Classic serif</option><option value="MODERN">Modern sans</option></select></label><label>Body style<select value={contentDraft.values.typography.bodyFont} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, typography: { ...contentDraft.values.typography, bodyFont: event.target.value as CinemaContent["typography"]["bodyFont"] } } })}><option value="SANS">Clean sans</option><option value="HUMANIST">Humanist sans</option><option value="SERIF">Serif</option></select></label></div>
            <h4>About page</h4><div className="form-grid"><label>Page title<input value={contentDraft.values.about.title} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, about: { ...contentDraft.values.about, title: event.target.value } } })} /></label><label>Introduction<input value={contentDraft.values.about.intro} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, about: { ...contentDraft.values.about, intro: event.target.value } } })} /></label><label>Experience heading<input value={contentDraft.values.about.experienceTitle} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, about: { ...contentDraft.values.about, experienceTitle: event.target.value } } })} /></label><label>Experience copy<textarea value={contentDraft.values.about.body.join("\n\n")} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, about: { ...contentDraft.values.about, body: event.target.value.split(/\n\s*\n/).filter(Boolean) } } })} /></label></div>
            <h4>Afterglow page</h4><div className="form-grid"><label>Hero image URL<input value={contentDraft.values.afterglow.imageUrl} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, afterglow: { ...contentDraft.values.afterglow, imageUrl: event.target.value } } })} /></label><label>Image description<input value={contentDraft.values.afterglow.imageAlt} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, afterglow: { ...contentDraft.values.afterglow, imageAlt: event.target.value } } })} /></label><label>Heading<input value={contentDraft.values.afterglow.sectionTitle} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, afterglow: { ...contentDraft.values.afterglow, sectionTitle: event.target.value } } })} /></label><label>Copy<textarea value={contentDraft.values.afterglow.body.join("\n\n")} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, afterglow: { ...contentDraft.values.afterglow, body: event.target.value.split(/\n\s*\n/).filter(Boolean) } } })} /></label></div>
            <h4>Dining &amp; Bar</h4><div className="form-grid"><label>Page title<input value={contentDraft.values.dining.title} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, dining: { ...contentDraft.values.dining, title: event.target.value } } })} /></label><label>Introduction<input value={contentDraft.values.dining.intro} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, dining: { ...contentDraft.values.dining, intro: event.target.value } } })} /></label></div>
            <h4>Private Events</h4><div className="form-grid"><label>Page title<input value={contentDraft.values.privateEvents.title} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, privateEvents: { ...contentDraft.values.privateEvents, title: event.target.value } } })} /></label><label>Introduction<input value={contentDraft.values.privateEvents.intro} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, privateEvents: { ...contentDraft.values.privateEvents, intro: event.target.value } } })} /></label><label>Closing heading<input value={contentDraft.values.privateEvents.closingTitle} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, privateEvents: { ...contentDraft.values.privateEvents, closingTitle: event.target.value } } })} /></label><label>Closing copy<textarea value={contentDraft.values.privateEvents.closingBody} onChange={(event) => setContentDraft({ ...contentDraft, values: { ...contentDraft.values, privateEvents: { ...contentDraft.values.privateEvents, closingBody: event.target.value } } })} /></label></div>
            <div className="live-brand-preview" style={{ fontFamily: contentDraft.values.typography.headingFont === "MODERN" ? "Arial, sans-serif" : "Georgia, serif" }}><span>LIVE DRAFT PREVIEW</span><strong>{contentDraft.values.about.title}</strong><small>{contentDraft.values.about.intro}</small></div>
            <button disabled={saving}>{saving ? "Saving…" : "Save private draft"}</button><p className="form-note">Last published: {location.content.publishedAt ? new Date(location.content.publishedAt).toLocaleString() : "Using built-in defaults"}. Use “Publish draft” after reviewing.</p>
          </form>}
          <footer className="detail-note">Attend Master changes are audited. Cinema staff retain their existing permissions and admin access.</footer>
        </article>)}
      </>}
    </section>}
    {!selectedOrganizationId && <>
    <section className="summary">
      <div><strong>{overview?.organizations.length ?? "—"}</strong><span>Organizations</span></div>
      <div><strong>{locations.length || "—"}</strong><span>Locations</span></div>
      <div><strong>{locations.filter((location) => location.active).length || "—"}</strong><span>Active locations</span></div>
      <div><strong>{locations.reduce((sum, location) => sum + location.configuration.upcomingShowtimes, 0) || "—"}</strong><span>Upcoming showtimes</span></div>
    </section>
    <section className="organizations">
      {!overview && !error && <p className="muted">Loading cinema clients…</p>}
      {overview?.organizations.map((organizationItem) => <article className="organization" key={organizationItem.id}>
        <div className="org-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>{organizationItem.name}</h2><p className="muted">{organizationItem.legalName ?? organizationItem.timezone}</p></div><div className="org-actions"><span className={organizationItem.payments.connected ? "status good" : "status warning"}>{organizationItem.payments.connected ? `Payments ${organizationItem.payments.onboardingStatus.toLowerCase()}` : "Payments not connected"}</span><button className="open-client" onClick={() => setSelectedOrganizationId(organizationItem.id)}>Open cinema →</button></div></div>
        <div className="location-list">{organizationItem.locations.map((location) => <div className="location" key={location.id}>
          <div><div className="location-title"><h3>{location.name}</h3><span className={location.active ? "dot active" : "dot"}>{location.active ? "Active" : "Inactive"}</span></div><p className="muted">{location.address ?? location.timezone}</p><code>{location.id}</code></div>
          <div className="signals">
            <span><b>{location.configuration.auditoriums}</b> auditoriums</span><span><b>{location.configuration.employees}</b> staff</span><span><b>{location.configuration.menuItems}</b> menu items</span><span><b>{location.configuration.upcomingShowtimes}</b> upcoming</span><span className={location.configuration.branding ? "configured" : "needs-attention"}>{location.configuration.branding ? "Brand configured" : "Default brand"}</span>
          </div>
          <div className="actions"><a href={CINEMA_ADMIN_URL} target="_blank" rel="noreferrer">Cinema admin ↗</a><a href={`${CUSTOMER_WEB_URL}?locationId=${encodeURIComponent(location.id)}`} target="_blank" rel="noreferrer">Customer site ↗</a></div>
        </div>)}</div>
      </article>)}
    </section>
    </>}
  </main>;
}
