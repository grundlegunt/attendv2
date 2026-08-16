"use client";

import type { FormEvent } from "react";

interface CompanySignInProps {
  email: string;
  password: string;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}

export function CompanySignIn({
  email,
  password,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: CompanySignInProps) {
  return (
    <main className="master-sign-in">
      <section className="master-sign-in-shell">
        <div className="master-sign-in-intro">
          <div className="master-wordmark">
            <span className="master-mark">A</span>
            <span><strong>ATTEND</strong><small>MASTER</small></span>
          </div>
          <div>
            <p className="eyebrow">PLATFORM OPERATIONS</p>
            <h1>Run every cinema from one place.</h1>
            <p className="muted">Oversee clients, revenue, onboarding, payments, and access before entering a cinema workspace.</p>
          </div>
          <ul className="master-capabilities">
            <li><span>01</span>Company-wide oversight</li>
            <li><span>02</span>Separate staff credentials</li>
            <li><span>03</span>Choose a client after sign in</li>
          </ul>
        </div>
        <form className="login-card master-sign-in-card" onSubmit={onSubmit}>
          <p className="eyebrow">ATTEND MASTER</p>
          <h2>Company sign in</h2>
          <p className="muted">Use your Attend company credentials.</p>
          {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
          <label>Email<input type="email" required autoComplete="email" autoFocus value={email} onChange={(event) => onEmailChange(event.target.value)} /></label>
          <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} /></label>
          <button type="submit">Sign in</button>
          <p className="master-sign-in-note">Cinema staff sign in through their cinema&apos;s Admin workspace.</p>
        </form>
      </section>
    </main>
  );
}
