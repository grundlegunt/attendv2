"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
type PlatformRole = "OWNER" | "OPERATOR" | "VIEWER";
interface Session { accessToken: string; user: { id: string; name: string; email: string; role: PlatformRole } }
interface TeamUser { id: string; name: string; email: string; role: PlatformRole; active: boolean; createdAt: string; updatedAt: string }

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }

export default function PlatformTeam() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [name, setName] = useState(""); const [newEmail, setNewEmail] = useState(""); const [newPassword, setNewPassword] = useState(""); const [newRole, setNewRole] = useState<PlatformRole>("OPERATOR");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [error, setError] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const teamRequestRef = useRef(0);
  const authRequestRef = useRef(0);

  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  const loadTeam = useCallback(async (current: Session) => { const requestId = ++teamRequestRef.current; try { const result = await request<{ users: TeamUser[] }>("/platform/team", undefined, current.accessToken); if (requestId === teamRequestRef.current) setUsers(result.users); } catch (reason) { if (requestId === teamRequestRef.current) setError(reason instanceof Error ? reason.message : "Could not load the Attend team."); } }, []);
  useEffect(() => { if (!session) return; void loadTeam(session); return () => { teamRequestRef.current += 1; }; }, [session, loadTeam]);

  async function login(event: FormEvent) { event.preventDefault(); const requestId = ++authRequestRef.current; setError(null); try { const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); if (requestId !== authRequestRef.current) return; window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  async function addOperator(event: FormEvent) { event.preventDefault(); if (!session) return; setCreating(true); setError(null); try { await request("/platform/team", { method: "POST", body: JSON.stringify({ name, email: newEmail, password: newPassword, role: newRole }) }, session.accessToken); setName(""); setNewEmail(""); setNewPassword(""); setNewRole("OPERATOR"); await loadTeam(session); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add the team member."); } finally { setCreating(false); } }
  async function setAccess(user: TeamUser) { if (!session) return; setWorkingId(user.id); setError(null); try { await request(`/platform/team/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) }, session.accessToken); await loadTeam(session); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update team access."); } finally { setWorkingId(null); } }
  async function setRole(user: TeamUser, role: PlatformRole) { if (!session) return; setWorkingId(user.id); setError(null); try { await request(`/platform/team/${user.id}`, { method: "PATCH", body: JSON.stringify({ role }) }, session.accessToken); await loadTeam(session); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the team role."); } finally { setWorkingId(null); } }
  async function resetPassword(user: TeamUser) { if (!session) return; const nextPassword = credentialDrafts[user.id] ?? ""; if (nextPassword.length < 12) { setError("Temporary passwords must contain at least 12 characters."); return; } setWorkingId(user.id); setError(null); try { await request(`/platform/team/${user.id}/credentials`, { method: "PATCH", body: JSON.stringify({ password: nextPassword }) }, session.accessToken); setCredentialDrafts((current) => ({ ...current, [user.id]: "" })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset the password."); } finally { setWorkingId(null); } }
  function signOut() { authRequestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); teamRequestRef.current += 1; setSession(null); setUsers([]); setError(null); }

  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;

  return <main className="shell">
    <header><div><p className="eyebrow platform-master-label" /><h1>Team</h1><p className="muted">Manage who can operate Ringo across every cinema client.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    <nav className="platform-nav" aria-label="Ringo Master"><Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link href="/onboarding">Onboarding</Link><Link href="/payments">Payments</Link><Link href="/content">Content</Link><Link href="/branding">Branding</Link><Link className="active" href="/team">Team</Link><Link href="/audit">Audit Log</Link></nav>
    {error && <div className="error">{error}</div>}
    <section className="team-layout">
      <form className="team-create" onSubmit={addOperator}><p className="eyebrow">ADD TEAM MEMBER</p><h2>New company login</h2><p className="muted">Owners manage team access, Operators manage cinema clients, and Viewers have read-only access.</p><label>Name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input required type="email" maxLength={254} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label><label>Role<select value={newRole} onChange={(event) => setNewRole(event.target.value as PlatformRole)}><option value="OPERATOR">Operator</option><option value="VIEWER">Viewer</option><option value="OWNER">Owner</option></select></label><label>Temporary password<input required type="password" minLength={12} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button disabled={creating}>{creating ? "Adding…" : "Add team member"}</button></form>
      <section className="team-roster"><div className="section-heading"><div><p className="eyebrow">COMPANY ACCESS</p><h2>{users.filter((user) => user.active).length} active team member{users.filter((user) => user.active).length === 1 ? "" : "s"}</h2></div></div>{users.map((user) => <article key={user.id}><div className="team-operator"><strong>{user.name}{user.id === session.user.id ? " (you)" : ""}</strong><span>{user.email}</span><small>Added {new Date(user.createdAt).toLocaleDateString()}</small><div className="team-password-reset"><label>Temporary password<input type="password" minLength={12} maxLength={200} value={credentialDrafts[user.id] ?? ""} onChange={(event) => setCredentialDrafts((current) => ({ ...current, [user.id]: event.target.value }))} /></label><button className="quiet" disabled={workingId === user.id || (credentialDrafts[user.id] ?? "").length < 12} onClick={() => void resetPassword(user)}>Reset password</button></div></div><div><label>Role<select value={user.role} disabled={workingId === user.id || user.id === session.user.id} onChange={(event) => void setRole(user, event.target.value as PlatformRole)}><option value="OWNER">Owner</option><option value="OPERATOR">Operator</option><option value="VIEWER">Viewer</option></select></label><span className={user.active ? "status good" : "status warning"}>{user.active ? "Active" : "Inactive"}</span><button className="quiet" disabled={workingId === user.id || user.id === session.user.id} onClick={() => void setAccess(user)}>{workingId === user.id ? "Saving…" : user.active ? "Deactivate" : "Reactivate"}</button></div></article>)}</section>
    </section>
  </main>;
}
