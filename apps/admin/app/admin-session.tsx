"use client";

import { adminBrandingDefaults, adminUiDefaults, type AdminUiConfig, type AuthenticatedEmployee, type AuthTokenResponse } from "@cinema/shared";
import { FormEvent, createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Session = { employee: AuthenticatedEmployee; accessToken: string };
type StaffLoginResponse = (AuthTokenResponse & { employee: AuthenticatedEmployee }) | { mfaRequired: true; challengeToken: string };
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; uri: string } | null>(null);
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
      const response = await apiFetch<StaffLoginResponse>("/auth/staff/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if ("mfaRequired" in response) { setMfaChallengeToken(response.challengeToken); setPassword(""); return; }
      const next = { employee: response.employee, accessToken: response.accessToken };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next); setCurrentPassword(password); setPassword("");
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "The request could not be completed.");
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/mfa/verify", { method: "POST", body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode }) });
      const next = { employee: response.employee, accessToken: response.accessToken };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next); setMfaChallengeToken(null); setMfaCode("");
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The code could not be verified."); }
  }

  async function startMfaSetup() {
    setError(null);
    try {
      setMfaSetup(await apiFetch<{ secret: string; uri: string }>("/auth/staff/mfa/setup", { accessToken: session!.accessToken, method: "POST" }));
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "MFA setup could not be started."); }
  }

  async function confirmMfaSetup(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/mfa/confirm", { accessToken: session!.accessToken, method: "POST", body: JSON.stringify({ code: mfaCode }) });
      const next = { employee: response.employee, accessToken: response.accessToken };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next); setMfaSetup(null); setMfaCode("");
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The code could not be verified."); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/change-password", { accessToken: session!.accessToken, method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      const next = { employee: response.employee, accessToken: response.accessToken };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The password could not be changed."); }
  }

  const value = useMemo(() => session ? { ...session, signOut: () => { window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setMfaSetup(null); setMfaCode(""); } } : null, [session]);
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
    "--showtime-remove-control": adminUi.removeControlColor, "--showtime-duplicate-control": adminUi.duplicateControlColor,
  } as CSSProperties;
  if (!restored) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><p>Loading Attend Admin…</p></main></div>;
  if (!value && mfaChallengeToken) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={verifyMfa}>
    <p className="kicker">TWO-STEP VERIFICATION</p><h1>Enter your authenticator code</h1><p className="muted">Open your authenticator app and enter the current 6-digit code.</p>{error && <div className="error-banner">{error}</div>}
    <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} /></label>
    <button className="primary">Verify and sign in</button><button type="button" className="secondary" onClick={() => { setMfaChallengeToken(null); setMfaCode(""); setError(null); }}>Back</button>
  </form></main></div>;
  if (!value) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={login}>
    <p className="kicker">ATTEND ADMIN</p><h1>{publicBranding?.name ? `${publicBranding.name} sign in` : "Manager sign in"}</h1>{error && <div className="error-banner">{error}</div>}
    <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button className="primary">Sign in</button>
  </form></main></div>;
  if (value.employee.mustChangePassword) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={changePassword}>
    <p className="kicker">SECURITY UPDATE REQUIRED</p><h1>Choose a new password</h1><p className="muted">A manager issued a temporary password. Replace it before continuing.</p>{error && <div className="error-banner">{error}</div>}
    <label>Temporary password<input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
    <label>New password<input type="password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
    <label>Confirm new password<input type="password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
    <button className="primary">Change password</button><button type="button" className="secondary" onClick={value.signOut}>Sign out</button>
  </form></main></div>;
  if (value.employee.mfaSetupRequired) return <div className="admin-theme-root" style={theme}><main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={confirmMfaSetup}>
    <p className="kicker">SECURITY SETUP REQUIRED</p><h1>Protect your account</h1><p className="muted">Your role requires two-step verification.</p>{error && <div className="error-banner">{error}</div>}
    {!mfaSetup ? <><p>Add a new account in Google Authenticator, 1Password, Authy, or another authenticator app.</p><button type="button" className="primary" onClick={startMfaSetup}>Set up authenticator</button></> : <>
      <div className="mfa-enrollment"><div className="mfa-qr"><QRCodeSVG value={mfaSetup.uri} size={196} marginSize={2} title="Authenticator enrollment QR code" /></div><div><h2>Scan the QR code</h2><p className="muted">In your authenticator app, add a new account and scan this code. The app does not need your personal Gmail address.</p><label>Can’t scan it? Enter this setup key instead.<output className="mfa-setup-key">{mfaSetup.secret}</output></label></div></div>
      <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} /></label>
      <button className="primary">Enable two-step verification</button>
    </>}
    <button type="button" className="secondary" onClick={value.signOut}>Sign out</button>
  </form></main></div>;
  return <AdminSessionContext.Provider value={value}><AdminUiContext.Provider value={adminUi}><div className="admin-theme-root" style={theme}>{children}</div></AdminUiContext.Provider></AdminSessionContext.Provider>;
}
