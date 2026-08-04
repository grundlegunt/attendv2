"use client";

import type { AuthenticatedEmployee, AuthTokenResponse } from "@cinema/shared";
import { FormEvent, createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Session = { employee: AuthenticatedEmployee; accessToken: string };
type AdminSessionValue = Session & { signOut: () => void };
const STORAGE_KEY = "attend-admin-session";
const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function useAdminSession() {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error("useAdminSession must be used inside AdminSessionProvider");
  return session;
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  if (!restored) return <main className="admin-shell login-shell"><p>Loading Attend Admin…</p></main>;
  if (!value) return <main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={login}>
    <p className="kicker">ATTEND ADMIN</p><h1>Manager sign in</h1>{error && <div className="error-banner">{error}</div>}
    <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button className="primary">Sign in</button>
  </form></main>;
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}
