"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clearPlatformRequestTimings, platformRequestTimingEvent, readPlatformRequestTimings } from "../platform-session";
import type { PlatformRequestTiming } from "../platform-session";

function duration(value: number | null) { return value === null ? "Unavailable" : `${value.toLocaleString()} ms`; }

export default function DiagnosticsPage() {
  const [timings, setTimings] = useState<PlatformRequestTiming[]>([]);
  useEffect(() => { const refresh = () => setTimings(readPlatformRequestTimings()); refresh(); window.addEventListener(platformRequestTimingEvent(), refresh); return () => window.removeEventListener(platformRequestTimingEvent(), refresh); }, []);
  const summary = useMemo(() => {
    const serverValues = timings.flatMap((timing) => timing.serverMs === null ? [] : [timing.serverMs]);
    return { requests: timings.length, slow: timings.filter((timing) => timing.totalMs >= 1_000).length, averageTotal: timings.length ? Math.round(timings.reduce((sum, timing) => sum + timing.totalMs, 0) / timings.length) : null, averageServer: serverValues.length ? Math.round(serverValues.reduce((sum, value) => sum + value, 0) / serverValues.length) : null };
  }, [timings]);
  return <main className="shell">
    <header><div><p className="eyebrow">ATTEND MASTER</p><h1>Request diagnostics</h1><p className="muted">Recent API latency from this browser session. Browser wait minus API time highlights network, cold-start, and response-transfer overhead.</p></div><button className="quiet" onClick={() => clearPlatformRequestTimings()}>Clear session data</button></header>
    <nav className="platform-nav" aria-label="Attend Master"><Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link href="/onboarding">Onboarding</Link><Link href="/payments">Payments</Link><Link href="/content">Content</Link><Link href="/branding">Branding</Link><Link href="/team">Team</Link><Link href="/audit">Audit Log</Link><Link className="active" href="/diagnostics">Diagnostics</Link></nav>
    <section className="diagnostic-summary"><article><span>Requests retained</span><strong>{summary.requests}</strong></article><article><span>Slow requests</span><strong>{summary.slow}</strong><small>1 second or longer</small></article><article><span>Average browser wait</span><strong>{duration(summary.averageTotal)}</strong></article><article><span>Average API time</span><strong>{duration(summary.averageServer)}</strong></article></section>
    <section className="diagnostic-table"><div><strong>Endpoint</strong><span>Status</span><span>Browser wait</span><span>API time</span><span>Outside API</span><span>Recorded</span></div>{timings.map((timing, index) => <article className={timing.totalMs >= 1_000 ? "slow" : ""} key={`${timing.recordedAt}-${index}`}><strong>{timing.path}</strong><span>{timing.status ?? "Network error"}</span><span>{duration(timing.totalMs)}</span><span>{duration(timing.serverMs)}</span><span>{duration(timing.serverMs === null ? null : Math.max(0, timing.totalMs - timing.serverMs))}</span><time>{new Date(timing.recordedAt).toLocaleTimeString()}</time></article>)}</section>
    {timings.length === 0 && <p className="empty-state">No requests recorded yet. Navigate through Attend Master, then return here.</p>}
  </main>;
}
