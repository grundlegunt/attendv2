"use client";

import { FormEvent, useState } from "react";
import type { AuthenticatedCustomer, AuthTokenResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Mode = "login" | "register";

/**
 * Milestone 0 scope: a real, working login/register screen against the
 * live API — proving the customer-auth flow end to end. The full "Now
 * Playing" homepage, seat maps, etc. arrive in later milestones per
 * IMPLEMENTATION_PLAN.md.
 */
export default function HomePage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<AuthenticatedCustomer | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body = mode === "login" ? { email, password } : { email, password, name: name || undefined };
      const res = await apiFetch<AuthTokenResponse & { customer: AuthenticatedCustomer }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCustomer(res.customer);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (customer) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1>Welcome, {customer.name ?? customer.email}</h1>
          <div className="success-banner">You&apos;re signed in. Showtimes and seat selection arrive in Milestone 1–2.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1>Ridgeline Dine-In Cinema</h1>
        <p className="subtitle">{mode === "login" ? "Sign in to your account" : "Create an account"}</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
