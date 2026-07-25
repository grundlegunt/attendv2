"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

interface AuditEventRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  occurredAt: string;
}

/**
 * Milestone 0 scope: manager login, then a real call to the
 * permission-gated GET /audit-events endpoint — this is the concrete proof
 * that the RBAC guard framework (SECURITY.md §2) works end to end from a
 * real frontend, not just in an API-level test. Full config screens,
 * reporting, and refunds arrive starting Milestone 10.
 */
export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<AuditEventRow[]>("/audit-events?limit=10", { accessToken })
      .then(setAuditEvents)
      .catch((err) => setAuditError(err instanceof ApiRequestError ? err.body.message : "Failed to load audit log."));
  }, [accessToken]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>(
        "/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setEmployee(res.employee);
      setAccessToken(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (employee) {
    return (
      <main className="auth-shell">
        <div className="auth-card profile-card">
          <h1>Manager Dashboard</h1>
          <p className="subtitle">
            Signed in as {employee.name} ({employee.roles.join(", ")})
          </p>

          {auditError && <div className="error-banner">{auditError}</div>}

          {auditEvents && (
            <div>
              <p className="subtitle">Recent audit events (requires audit.log.view):</p>
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td>{ev.action}</td>
                      <td>{ev.entityType}</td>
                      <td>{ev.actorType}</td>
                      <td>{new Date(ev.occurredAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1>Manager Sign In</h1>
        <p className="subtitle">Theater management &amp; reporting</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
