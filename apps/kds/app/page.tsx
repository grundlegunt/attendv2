"use client";

import { FormEvent, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

/**
 * Milestone 0 scope: staff login proving this device can authenticate.
 * The actual kitchen/bar ticket queue (per RESTAURANT_WORKFLOW.md §5-6)
 * arrives in Milestone 7.
 */
export default function KdsLoginPage() {
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
          <h1>Station ready</h1>
          <p className="subtitle">
            Signed in as {employee.name} ({employee.roles.join(", ")})
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1>Kitchen / Bar Display</h1>
        <p className="subtitle">Sign in to open this station</p>

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
