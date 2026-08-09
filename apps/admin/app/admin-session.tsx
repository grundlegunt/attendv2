"use client";

import { adminBrandingDefaults, adminUiDefaults, type AdminUiConfig, type AuthenticatedEmployee, type AuthTokenResponse } from "@cinema/shared";
import { FormEvent, createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Session = { employee: AuthenticatedEmployee; accessToken: string };
type PublicAdminBranding = { name: string; accentColor: string | null; accentMutedColor: string | null; backgroundColor: string | null; surfaceColor: string | null; textColor: string | null; mutedTextColor: string | null; ui?: AdminUiConfig | null };
type AdminSessionValue = Session & { signOut: () => void };
const STORAGE_KEY = "attend-admin-session";
const AdminSessionContext = createContext<AdminSessionValue | null>(null);
const AdminUiContext = createContext<AdminUiConfig>(adminUiDefaults);

export function useAdminSession() {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error("useAdminSession must be used inside AdminSessionProvider");
  return session;
}

export function useAdminUi() { return useContext(AdminUiContext); }

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publicBranding, setPublicBranding] = useState<PublicAdminBranding | null>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) setSession(JSON.parse(stored) as Session);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    const locationId = session?.employee.locationId ?? process.env.NEXT_PUBLIC_LOCATION_ID;
    apiFetch<PublicAdminBranding>(`/cinema/admin-branding${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""}`)
      .then(setPublicBranding)
      .catch(() => undefined);
  }, [session?.employee.locationId]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const next = { employee: response.employee, accessToken: response.accessToken };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next); setPassword("");
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "The request could not be completed.");
    }
  }

  const value = useMemo(() => session ? { ...session, signOut: () => { window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); } } : null, [session]);
  const branding = value?.employee.adminBranding ?? publicBranding;
  const adminUi = publicBranding?.ui ?? adminUiDefaults;
  const fontFamilies: Record<AdminUiConfig["fontFamily"], string> = { SYSTEM: "Inter, ui-sans-serif, system-ui, sans-serif", SERIF: "Georgia, 'Times New Roman', serif", MODERN: "'Avenir Next', 'Helvetica Neue', Arial, sans-serif", MONO: "'SFMono-Regular', Consolas, monospace" };
  const theme = {
    "--color-accent": branding?.accentColor ?? adminBrandingDefaults.accentColor,
    "--color-accent-muted": branding?.accentMutedColor ?? adminBrandingDefaults.accentMutedColor,
    "--color-bg": branding?.backgroundColor ?? adminBrandingDefaults.backgroundColor,
    "--color-bg-elevated": branding?.surfaceColor ?? adminBrandingDefaults.surfaceColor,
    "--color-text-primary": branding?.textColor ?? adminBrandingDefaults.textColor,
    "--color-text-secondary": branding?.mutedTextColor ?? adminBrandingDefaults.mutedTextColor,
    "--color-border": branding?.accentMutedColor ?? adminBrandingDefaults.accentMutedColor,
    "--accent": branding?.accentColor ?? adminBrandingDefaults.accentColor,
    "--muted": branding?.mutedTextColor ?? adminBrandingDefaults.mutedTextColor,
    "--line": branding?.accentMutedColor ?? adminBrandingDefaults.accentMutedColor,
    "--admin-font-family": fontFamilies[adminUi.fontFamily], "--schedule-on-sale": adminUi.onSaleColor, "--schedule-draft": adminUi.draftColor, "--schedule-past": adminUi.pastColor,
  } as CSSProperties;
  if (!restored) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><p>Loading Attend Admin…</p></main></div>;
  if (!value) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={login}>
    <p className="kicker">ATTEND ADMIN</p><h1>{publicBranding?.name ? `${publicBranding.name} sign in` : "Manager sign in"}</h1>{error && <div className="error-banner">{error}</div>}
    <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button className="primary">Sign in</button>
  </form></main></div>;
  return <AdminSessionContext.Provider value={value}><AdminUiContext.Provider value={adminUi}><div className="admin-theme-root" style={theme}>{children}</div></AdminUiContext.Provider></AdminSessionContext.Provider>;
}
