"use client";

import type { FormEvent } from "react";
import { usePlatformBrand } from "./platform-brand";

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
  const brand = usePlatformBrand();
  const initial = brand.companyName.slice(0, 1).toUpperCase();
  return (
    <main className="master-sign-in">
      <section className="master-sign-in-shell">
        <div className="master-sign-in-intro">
          <div className="master-wordmark">
            <span className="master-mark">{initial}</span>
            <span><strong>{brand.companyName.toUpperCase()}</strong><small>MASTER</small></span>
          </div>
          <div>
            <p className="eyebrow">{brand.masterSignIn.eyebrow}</p>
            <h1>{brand.masterSignIn.title}</h1>
            <p className="muted">{brand.masterSignIn.description}</p>
          </div>
          <ul className="master-capabilities">
            <li><span>01</span>Company-wide oversight</li>
            <li><span>02</span>Separate staff credentials</li>
            <li><span>03</span>Choose a client after sign in</li>
          </ul>
        </div>
        <form className="login-card master-sign-in-card" onSubmit={onSubmit}>
          <p className="eyebrow">{brand.companyName.toUpperCase()} MASTER</p>
          <h2>{brand.masterSignIn.formTitle}</h2>
          <p className="muted">{brand.masterSignIn.formDescription}</p>
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
