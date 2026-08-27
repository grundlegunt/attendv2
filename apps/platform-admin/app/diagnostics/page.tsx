"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { clearPlatformRequestTimings, platformRequest, platformRequestTimingEvent, readPlatformRequestTimings, readPlatformSession, revokePlatformSession } from "../platform-session";
import type { PlatformRequestTiming } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
interface Session { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } }

function duration(value: number | null) { return value === null ? "Unavailable" : `${value.toLocaleString()} ms`; }

export default function DiagnosticsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [timings, setTimings] = useState<PlatformRequestTiming[]>([]);
  const authRequestRef = useRef(0);
  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  useEffect(() => { const refresh = () => setTimings(readPlatformRequestTimings()); refresh(); window.addEventListener(platformRequestTimingEvent(), refresh); return () => window.removeEventListener(platformRequestTimingEvent(), refresh); }, []);
  const summary = useMemo(() => {
    const serverValues = timings.flatMap((timing) => timing.serverMs === null ? [] : [timing.serverMs]);
    return { requests: timings.length, slow: timings.filter((timing) => timing.totalMs >= 1_000).length, averageTotal: timings.length ? Math.round(timings.reduce((sum, timing) => sum + timing.totalMs, 0) / timings.length) : null, averageServer: serverValues.length ? Math.round(serverValues.reduce((sum, value) => sum + value, 0) / serverValues.length) : null };
  }, [timings]);
  async function login(event: FormEvent) { event.preventDefault(); const requestId = ++authRequestRef.current; setError(null); try { const result = await platformRequest<Session>(API_BASE_URL, STORAGE_KEY, "/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); if (requestId !== authRequestRef.current) return; window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  function signOut() { authRequestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setError(null); }
  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;
  return <main className="shell">
    <header><div><p className="eyebrow platform-master-label" /><h1>Request diagnostics</h1><p className="muted">Recent API latency from this browser session. Browser wait minus API time highlights network, cold-start, and response-transfer overhead.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={() => clearPlatformRequestTimings()}>Clear session data</button><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    <PlatformNav role={session.user.role} />
    <section className="diagnostic-summary"><article><span>Requests retained</span><strong>{summary.requests}</strong></article><article><span>Slow requests</span><strong>{summary.slow}</strong><small>1 second or longer</small></article><article><span>Average browser wait</span><strong>{duration(summary.averageTotal)}</strong></article><article><span>Average API time</span><strong>{duration(summary.averageServer)}</strong></article></section>
    <section className="diagnostic-table"><div><strong>Endpoint</strong><span>Status</span><span>Browser wait</span><span>API time</span><span>Outside API</span><span>Recorded</span></div>{timings.map((timing, index) => <article className={timing.totalMs >= 1_000 ? "slow" : ""} key={`${timing.recordedAt}-${index}`}><strong>{timing.path}</strong><span>{timing.status ?? "Network error"}</span><span>{duration(timing.totalMs)}</span><span>{duration(timing.serverMs)}</span><span>{duration(timing.serverMs === null ? null : Math.max(0, timing.totalMs - timing.serverMs))}</span><time>{new Date(timing.recordedAt).toLocaleTimeString()}</time></article>)}</section>
    {timings.length === 0 && <p className="empty-state">No requests recorded yet. Navigate through Ringo Master, then return here.</p>}
  </main>;
}
