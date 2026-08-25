"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminRequestTimingEvent,
  clearAdminRequestTimings,
  readAdminRequestTimings,
} from "../lib/request-diagnostics";
import type { AdminRequestTiming } from "../lib/request-diagnostics";

function duration(value: number | null) {
  return value === null ? "Unavailable" : `${value.toLocaleString()} ms`;
}

function bytes(value: number | null) {
  if (value === null) return "Not reported";
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(value >= 102_400 ? 0 : 1)} KB`;
}

export default function DiagnosticsPage() {
  const [timings, setTimings] = useState<AdminRequestTiming[]>([]);
  useEffect(() => {
    const refresh = () => setTimings(readAdminRequestTimings());
    refresh();
    window.addEventListener(adminRequestTimingEvent(), refresh);
    return () => window.removeEventListener(adminRequestTimingEvent(), refresh);
  }, []);

  const summary = useMemo(() => {
    const serverValues = timings.flatMap((timing) => timing.serverMs === null ? [] : [timing.serverMs]);
    return {
      requests: timings.length,
      slow: timings.filter((timing) => timing.totalMs >= 1_000).length,
      averageTotal: timings.length ? Math.round(timings.reduce((sum, timing) => sum + timing.totalMs, 0) / timings.length) : null,
      averageServer: serverValues.length ? Math.round(serverValues.reduce((sum, value) => sum + value, 0) / serverValues.length) : null,
    };
  }, [timings]);

  return <main className="admin-shell diagnostics-page">
    <header className="dashboard-heading"><div><p className="kicker">OPERATIONS</p><h1>Request diagnostics</h1><p>Recent Admin API latency from this browser session. This data stays in this tab and never includes request bodies, tokens, or customer records.</p></div><button className="secondary" type="button" onClick={clearAdminRequestTimings}>Clear session data</button></header>
    <section className="dashboard-metrics diagnostics-summary"><article className="dashboard-metric"><span>Requests retained</span><strong>{summary.requests}</strong><small>Most recent 100</small></article><article className="dashboard-metric"><span>Slow requests</span><strong>{summary.slow}</strong><small>1 second or longer</small></article><article className="dashboard-metric"><span>Average browser wait</span><strong>{duration(summary.averageTotal)}</strong><small>Request through body download</small></article><article className="dashboard-metric"><span>Average API time</span><strong>{duration(summary.averageServer)}</strong><small>Reported by the API</small></article></section>
    <section className="panel diagnostics-explanation"><strong>How to read this</strong><p>High API time points to server or database work. High outside-API time points to network, cold-start connection overhead, transfer, or browser processing. Response size is shown when the server reports it.</p></section>
    <section className="diagnostics-table" aria-label="Recent Admin API requests"><div className="diagnostics-row diagnostics-header"><strong>Admin page / endpoint</strong><span>Status</span><span>Browser wait</span><span>API time</span><span>Outside API</span><span>Size</span><span>Recorded</span></div>{timings.map((timing, index) => <article className={`diagnostics-row ${timing.totalMs >= 1_000 ? "slow" : ""}`} key={`${timing.recordedAt}-${index}`}><strong><small>{timing.page}</small>{timing.method} {timing.path}</strong><span>{timing.status ?? "Network error"}</span><span>{duration(timing.totalMs)}</span><span>{duration(timing.serverMs)}</span><span>{duration(timing.serverMs === null ? null : Math.max(0, timing.totalMs - timing.serverMs))}</span><span>{bytes(timing.responseBytes)}</span><time>{new Date(timing.recordedAt).toLocaleTimeString()}</time></article>)}</section>
    {timings.length === 0 && <p className="dashboard-empty diagnostics-empty">No requests recorded yet. Navigate through Admin, then return here.</p>}
  </main>;
}
