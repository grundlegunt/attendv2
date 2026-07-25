"use client";

import { FormEvent, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

/**
 * Milestone 0 scope: staff login against the live API, proving the
 * RBAC-carrying access token round-trips correctly. The auditorium seat
 * grid and ordering UI (per RESTAURANT_WORKFLOW.md §3) arrive starting
 * Milestone 6/9.
 */
export default function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);

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
          <h1>Welcome, {employee.name}</h1>
          <p className="subtitle">
            Roles: {employee.roles.join(", ")} · Location: {employee.locationId}
          </p>
          <div>
            {employee.permissions.map((p) => (
              <span key={p} className="permission-chip">
                {p}
              </span>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1>Staff Sign In</h1>
        <p className="subtitle">Box office &amp; server access</p>

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
