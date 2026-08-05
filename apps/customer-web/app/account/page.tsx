"use client";

import { FormEvent, useState } from "react";
import type { AuthenticatedCustomer, AuthTokenResponse } from "@cinema/shared";
import { LiveRestaurantTab } from "../components/live-restaurant-tab";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Mode = "login" | "register";

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<AuthenticatedCustomer | null>(null);
  const [customerAccessToken, setCustomerAccessToken] = useState("");
  const [liveTabId, setLiveTabId] = useState("");
  const [tabLookup, setTabLookup] = useState("");
  const [guestTabToken, setGuestTabToken] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body = mode === "login" ? { email, password } : { email, password, name: name || undefined };
      const response = await apiFetch<AuthTokenResponse & { customer: AuthenticatedCustomer }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCustomer(response.customer);
      setCustomerAccessToken(response.accessToken);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (guestTabToken) {
    return (
      <main className="cinema-shell route-page">
        <LiveRestaurantTab guestToken={guestTabToken} onClose={() => setGuestTabToken("")} />
      </main>
    );
  }

  if (liveTabId && customerAccessToken) {
    return (
      <main className="cinema-shell route-page">
        <LiveRestaurantTab tabId={liveTabId} accessToken={customerAccessToken} onClose={() => setLiveTabId("")} />
      </main>
    );
  }

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">YOUR VISIT</span>
        <h1>Account</h1>
        <p>Sign in to view a dining tab, or use the secure token from a guest tab link.</p>
      </section>

      <div className="account-grid">
        <section className="content-panel">
          <h2>Open a dining tab</h2>
          <label className="field">
            <span>{customer ? "Tab ID from your ticket or server" : "Secure tab link token"}</span>
            <input value={tabLookup} onChange={(event) => setTabLookup(event.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!tabLookup.trim()}
            onClick={() => customer ? setLiveTabId(tabLookup.trim()) : setGuestTabToken(tabLookup.trim())}
          >
            View live tab
          </button>
        </section>

        {customer ? (
          <section className="content-panel">
            <span className="eyebrow">SIGNED IN</span>
            <h2>{customer.name ?? customer.email}</h2>
            <p className="secondary-copy">Use your tab ID to follow dining charges during your visit.</p>
          </section>
        ) : (
          <section className="content-panel" aria-label="Customer account">
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            {error && <div className="error-banner">{error}</div>}
            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
              )}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <button className="primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
