"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Settings = { priceTiers: Array<{ id: string; name: string; ticketPriceMinor: number; active: boolean }>; taxRules: Array<{ id: string; name: string; appliesTo: string; ratePermille: number; active: boolean }>; serviceChargeRules: Array<{ id: string; name: string; appliesTo: string; ratePermille: number | null; flatCents: number | null; autoApply: boolean; active: boolean }> };
type People = {
  employees: Array<{ id: string; name: string; email: string; active: boolean; authAccount: { mfaEnabled: boolean } | null; employeeRoles: Array<{ roleId: string; role: { key: string; name: string } }> }>;
  roles: Array<{ id: string; key: string; name: string; rolePermissions: Array<{ permission: { key: string } }> }>;
  permissions: Array<{ id: string; key: string; description: string }>;
};
type Refunds = {
  ticketOrders: Array<{ id: string; status: string; orderNumber: string; totalCents: number; guestName: string | null; guestEmail: string | null; payment: { status: string; verificationFailedAt: string | null; verificationFailureNote: string | null; refunds: RefundAttempt[] } | null; tickets: Array<{ id: string; showtimeSeat: { seat: { label: string }; showtime: { movie: { title: string } } } }>; cashTransactions: Array<{ type: string; amountCents: number }> }>;
  restaurantTabs: Array<{ id: string; status: string; label: string | null; totalCents: number | null; primaryCustomer: { name: string | null; email: string | null } | null; showtime: { movie: { title: string } } | null; receipt: { receiptNumber: string } | null; payments: Array<{ status: string; refunds: RefundAttempt[] }> }>;
};

type RefundAttempt = { status: string; amountCents: number; createdAt: string; reason: string | null; providerRefundId: string | null };

const permissionGroups = [
  { label: "Employees & access", prefixes: ["employee."] },
  { label: "Audit", prefixes: ["audit."] },
  { label: "Films, showtimes & tickets", prefixes: ["auditorium.", "movie.", "showtime.", "seat.", "ticket."] },
  { label: "Restaurant & menu", prefixes: ["restaurant.", "kitchen.", "menu."] },
  { label: "Payments", prefixes: ["payment."] },
  { label: "Reports & finance", prefixes: ["reports."] },
  { label: "Other", prefixes: [] },
] as const;

function permissionGroup(key: string) {
  return permissionGroups.find((group) => group.prefixes.some((prefix) => key.startsWith(prefix)))?.label ?? "Other";
}

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const unresolvedRefund = (status: string) => status === "CREATED" || status === "PROCESSING" || status === "FAILED";
const ticketNeedsAttention = (order: Refunds["ticketOrders"][number]) => Boolean(order.payment?.verificationFailedAt) || Boolean(order.payment?.refunds.some((refund) => unresolvedRefund(refund.status)));
const tabNeedsAttention = (tab: Refunds["restaurantTabs"][number]) => tab.status === "MANAGER_REVIEW" || tab.payments.some((payment) => payment.refunds.some((refund) => unresolvedRefund(refund.status)));

type ControlSection = "taxes" | "users" | "refunds";

export function ManagementControls({ accessToken, permissions, section }: { accessToken: string; permissions: string[]; section: ControlSection }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [refunds, setRefunds] = useState<Refunds | null>(null);
  const [refundHistory, setRefundHistory] = useState<Refunds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tax, setTax] = useState({ name: "", appliesTo: "ALL", ratePermille: 0 });
  const [charge, setCharge] = useState({ name: "", appliesTo: "ALL", ratePermille: 0 });
  const [newPriceTier, setNewPriceTier] = useState({ name: "Standard", price: "" });
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [employee, setEmployee] = useState({ name: "", email: "", password: "", pin: "", roleId: "" });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [selectedRoleName, setSelectedRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [employeeRoleDrafts, setEmployeeRoleDrafts] = useState<Record<string, string[]>>({});
  const [employeeIdentityDrafts, setEmployeeIdentityDrafts] = useState<Record<string, { name: string; email: string }>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, { password: string; pin: string }>>({});
  const [refundReason, setRefundReason] = useState("Customer-requested full refund");
  const [drawerId, setDrawerId] = useState("");
  const [refundQuery, setRefundQuery] = useState("");
  const [historyFrom, setHistoryFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [historyTo, setHistoryTo] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const canConfig = permissions.includes("ticket.price.edit");
  const canMenuConfig = permissions.includes("menu.edit");
  const canPeople = permissions.includes("employee.edit");
  const canPermissions = permissions.includes("employee.permissions.edit");
  const canRefund = permissions.includes("payment.refund") || permissions.includes("ticket.refund");

  async function refresh() {
    try {
      const [nextSettings, nextPeople, nextRefunds, nextRefundHistory] = await Promise.all([
        section === "taxes" && canConfig ? apiFetch<Settings>("/management/settings", { accessToken }) : null,
        section === "users" && canPeople ? apiFetch<People>("/management/people", { accessToken }) : null,
        section === "refunds" && canRefund ? apiFetch<Refunds>(`/management/refunds${refundQuery.trim() ? `?query=${encodeURIComponent(refundQuery.trim())}` : ""}`, { accessToken }) : null,
        section === "refunds" && canRefund ? apiFetch<Refunds>(`/management/refunds/history?from=${encodeURIComponent(new Date(`${historyFrom}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${historyTo}T00:00:00`).toISOString())}${refundQuery.trim() ? `&query=${encodeURIComponent(refundQuery.trim())}` : ""}`, { accessToken }) : null,
      ]);
      setSettings(nextSettings); setPeople(nextPeople); setRefunds(nextRefunds); setRefundHistory(nextRefundHistory);
      if (nextSettings) setPriceDrafts(Object.fromEntries(nextSettings.priceTiers.map((tier) => [tier.id, (tier.ticketPriceMinor / 100).toFixed(2)])));
      if (nextPeople) {
        if (!selectedRoleId) setSelectedRoleId(nextPeople.roles[0]?.id ?? "");
        setEmployeeRoleDrafts(Object.fromEntries(nextPeople.employees.map((person) => [person.id, person.employeeRoles.map((entry) => entry.roleId)])));
        setEmployeeIdentityDrafts(Object.fromEntries(nextPeople.employees.map((person) => [person.id, { name: person.name, email: person.email }])));
      }
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Management controls could not be loaded."); }
  }
  useEffect(() => { void refresh(); }, [accessToken, section]);

  const selectedRole = useMemo(() => people?.roles.find((role) => role.id === selectedRoleId), [people, selectedRoleId]);
  const groupedPermissions = useMemo(() => permissionGroups.map((group) => ({
    label: group.label,
    permissions: people?.permissions.filter((permission) => permissionGroup(permission.key) === group.label) ?? [],
  })).filter((group) => group.permissions.length), [people]);
  useEffect(() => { setSelectedPermissions(selectedRole?.rolePermissions.map((entry) => entry.permission.key) ?? []); }, [selectedRole]);
  useEffect(() => { setSelectedRoleName(selectedRole?.name ?? ""); }, [selectedRole]);

  function setPermissionGroup(keys: string[], enabled: boolean) {
    setSelectedPermissions((current) => enabled ? [...new Set([...current, ...keys])] : current.filter((key) => !keys.includes(key)));
  }

  async function createTax(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/settings/tax-rules", { accessToken, method: "POST", body: JSON.stringify({ ...tax, active: true }) }); setTax({ name: "", appliesTo: "ALL", ratePermille: 0 }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function createPrice(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/settings/price-tiers", { accessToken, method: "POST", body: JSON.stringify({ name: newPriceTier.name, ticketPriceMinor: Math.round(Number(newPriceTier.price) * 100) }) }); setNewPriceTier({ name: "Standard", price: "" }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function savePrice(tier: Settings["priceTiers"][number]) {
    const ticketPriceMinor = Math.round(Number(priceDrafts[tier.id]) * 100);
    if (!Number.isFinite(ticketPriceMinor) || ticketPriceMinor < 0) { setError("Enter a valid ticket price."); return; }
    try { await apiFetch(`/management/settings/price-tiers/${tier.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ ticketPriceMinor }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function createCharge(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/settings/service-charge-rules", { accessToken, method: "POST", body: JSON.stringify({ ...charge, active: true, autoApply: true }) }); setCharge({ name: "", appliesTo: "ALL", ratePermille: 0 }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function updateRule(kind: "tax" | "service", id: string, changes: Record<string, boolean>) {
    setError(null);
    try {
      const path = kind === "tax" ? `/management/settings/tax-rules/${id}` : `/management/settings/service-charge-rules/${id}`;
      await apiFetch(path, { accessToken, method: "PATCH", body: JSON.stringify(changes) });
      await refresh();
    } catch (reason) { showError(reason); }
  }
  async function createEmployee(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/employees", { accessToken, method: "POST", body: JSON.stringify({ name: employee.name, email: employee.email, password: employee.password, pin: employee.pin || undefined, roleIds: [employee.roleId] }) }); setEmployee({ name: "", email: "", password: "", pin: "", roleId: "" }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function saveRole() {
    if (!selectedRoleId) return;
    try { await apiFetch(`/management/roles/${selectedRoleId}/permissions`, { accessToken, method: "PATCH", body: JSON.stringify({ permissionKeys: selectedPermissions }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function createRole(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const created = await apiFetch<{ id: string }>("/management/roles", { accessToken, method: "POST", body: JSON.stringify({ name: newRoleName }) });
      setNewRoleName("");
      await refresh();
      setSelectedRoleId(created.id);
    } catch (reason) { showError(reason); }
  }
  async function renameRole() {
    if (!selectedRole?.key.startsWith("CUSTOM_")) return;
    try { await apiFetch(`/management/roles/${selectedRole.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ name: selectedRoleName }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function deleteRole() {
    if (!selectedRole?.key.startsWith("CUSTOM_") || !window.confirm(`Delete the role “${selectedRole.name}”? This cannot be undone.`)) return;
    try {
      await apiFetch(`/management/roles/${selectedRole.id}`, { accessToken, method: "DELETE" });
      const fallbackId = people?.roles.find((role) => role.id !== selectedRole.id)?.id ?? "";
      setSelectedRoleId(fallbackId);
      await refresh();
    } catch (reason) { showError(reason); }
  }
  async function toggleEmployee(target: People["employees"][number]) {
    try { await apiFetch(`/management/employees/${target.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ active: !target.active }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function saveEmployeeIdentity(target: People["employees"][number]) {
    const draft = employeeIdentityDrafts[target.id];
    if (!draft?.name.trim() || !draft.email.trim()) { setError("Employee name and email are required."); return; }
    try { await apiFetch(`/management/employees/${target.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ name: draft.name, email: draft.email }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function saveEmployeeRoles(target: People["employees"][number]) {
    const roleIds = employeeRoleDrafts[target.id] ?? [];
    if (!roleIds.length) { setError("Every employee must retain at least one role."); return; }
    try { await apiFetch(`/management/employees/${target.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ roleIds }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function resetEmployeeCredentials(target: People["employees"][number], field: "password" | "pin", removePin = false) {
    const draft = credentialDrafts[target.id] ?? { password: "", pin: "" };
    if (field === "password" && draft.password.length < 12) { setError("Temporary passwords must contain at least 12 characters."); return; }
    if (field === "pin" && !removePin && !/^\d{4,8}$/.test(draft.pin)) { setError("PINs must contain 4 to 8 digits."); return; }
    if (!window.confirm(`${removePin ? "Remove the PIN for" : `Reset ${field} for`} ${target.name}? Existing sessions will not be able to refresh.${field === "password" ? " Their authenticator will also be reset so they can enroll again." : ""}`)) return;
    try {
      await apiFetch(`/management/employees/${target.id}/credentials`, { accessToken, method: "PATCH", body: JSON.stringify(field === "password" ? { password: draft.password } : { pin: removePin ? null : draft.pin }) });
      setCredentialDrafts((current) => ({ ...current, [target.id]: { password: "", pin: "" } }));
      setError(null);
    } catch (reason) { showError(reason); }
  }
  async function resetEmployeeMfa(target: People["employees"][number]) {
    if (!window.confirm(`Reset two-step verification for ${target.name}? Existing sessions will not be able to refresh, and they must enroll a new authenticator the next time they sign in.`)) return;
    try {
      await apiFetch(`/management/employees/${target.id}/credentials`, { accessToken, method: "PATCH", body: JSON.stringify({ resetMfa: true }) });
      setError(null);
      await refresh();
    } catch (reason) { showError(reason); }
  }
  async function refund(scope: "ticket" | "restaurant", id: string, cashRequired = false) {
    if (!window.confirm(`Issue a full ${scope} refund? This cannot be undone.`)) return;
    try {
      const path = scope === "ticket" ? `/management/refunds/ticket-orders/${id}` : `/management/refunds/restaurant-tabs/${id}`;
      await apiFetch(path, { accessToken, method: "POST", body: JSON.stringify({ requestId: crypto.randomUUID(), reason: refundReason, ...(cashRequired && drawerId ? { cashDrawerId: drawerId } : {}) }) });
      await refresh();
    } catch (reason) { showError(reason); }
  }
  function showError(reason: unknown) { setError(reason instanceof ApiRequestError ? reason.body.message : "The action could not be completed."); }

  return <section className="management-stack">
    {error && <div className="error-banner">{error}</div>}
    {section === "taxes" && (canConfig || canMenuConfig) && <section className="admin-grid">
      {canConfig && <form className="panel" onSubmit={(event) => void createPrice(event)}><p className="kicker">TICKET PRICES</p><h2>Admission pricing</h2><p className="muted">Set the admission amount for each ticket group. Attend's per-ticket fee is controlled separately by Master.</p><div className="rule-list">{settings?.priceTiers.map((tier) => <article key={tier.id}><div><strong>{tier.name}</strong><span>{tier.active ? "Active" : "Inactive"}</span></div><div className="rule-actions"><label>Price<input type="number" min="0" step="0.01" value={priceDrafts[tier.id] ?? ""} onChange={(event) => setPriceDrafts((current) => ({ ...current, [tier.id]: event.target.value }))} /></label><button type="button" className="secondary" onClick={() => void savePrice(tier)}>Save price</button></div></article>)}</div><hr /><h3>Add ticket group</h3><label>Name<input required value={newPriceTier.name} onChange={(event) => setNewPriceTier({ ...newPriceTier, name: event.target.value })} /></label><label>Ticket price<input required type="number" min="0" step="0.01" value={newPriceTier.price} onChange={(event) => setNewPriceTier({ ...newPriceTier, price: event.target.value })} /></label><button className="primary">Add ticket group</button></form>}
      {canMenuConfig && <form className="panel" onSubmit={(event) => void createTax(event)}><p className="kicker">TAX RULES</p><h2>Add restaurant tax</h2><label>Name<input required value={tax.name} onChange={(event) => setTax({ ...tax, name: event.target.value })} /></label><label>Category<select value={tax.appliesTo} onChange={(event) => setTax({ ...tax, appliesTo: event.target.value })}><option value="ALL">All</option><option value="FOOD">Food</option><option value="ALCOHOL">Alcohol</option><option value="NA_BEVERAGE">Non-alcoholic beverage</option></select></label><label>Rate in tenths of a percent<input type="number" min="0" max="1000" value={tax.ratePermille} onChange={(event) => setTax({ ...tax, ratePermille: Number(event.target.value) })} /></label><button className="primary">Add tax rule</button><div className="rule-list">{settings?.taxRules.map((rule) => <article key={rule.id}><div><strong>{rule.name}</strong><span>{(rule.ratePermille / 10).toFixed(1)}% · {rule.appliesTo}</span></div><button type="button" className="secondary" onClick={() => void updateRule("tax", rule.id, { active: !rule.active })}>{rule.active ? "Deactivate" : "Activate"}</button></article>)}</div></form>}
      {canMenuConfig && <form className="panel" onSubmit={(event) => void createCharge(event)}><p className="kicker">SERVICE CHARGES</p><h2>Add automatic charge</h2><label>Name<input required value={charge.name} onChange={(event) => setCharge({ ...charge, name: event.target.value })} /></label><label>Category<select value={charge.appliesTo} onChange={(event) => setCharge({ ...charge, appliesTo: event.target.value })}><option value="ALL">All</option><option value="FOOD">Food</option><option value="ALCOHOL">Alcohol</option><option value="NA_BEVERAGE">Non-alcoholic beverage</option></select></label><label>Rate in tenths of a percent<input type="number" min="0" max="1000" value={charge.ratePermille} onChange={(event) => setCharge({ ...charge, ratePermille: Number(event.target.value) })} /></label><button className="primary">Add service charge</button><div className="rule-list">{settings?.serviceChargeRules.map((rule) => <article key={rule.id}><div><strong>{rule.name}</strong><span>{rule.ratePermille != null ? `${(rule.ratePermille / 10).toFixed(1)}%` : money(rule.flatCents ?? 0)} · {rule.appliesTo}{rule.active ? "" : " · INACTIVE"}</span></div><div className="rule-actions"><button type="button" className="secondary" disabled={!rule.active} onClick={() => void updateRule("service", rule.id, { autoApply: !rule.autoApply })}>{rule.autoApply ? "Automatic" : "Not applied"}</button><button type="button" className="secondary" onClick={() => void updateRule("service", rule.id, { active: !rule.active })}>{rule.active ? "Deactivate" : "Activate"}</button></div></article>)}</div></form>}
    </section>}

    {people && <section className="admin-grid"><form className="panel" onSubmit={(event) => void createEmployee(event)}><p className="kicker">USERS</p><h2>Add employee</h2><label>Name<input required value={employee.name} onChange={(event) => setEmployee({ ...employee, name: event.target.value })} /></label><label>Email<input type="email" required value={employee.email} onChange={(event) => setEmployee({ ...employee, email: event.target.value })} /></label><label>Temporary password<input type="password" minLength={12} required value={employee.password} onChange={(event) => setEmployee({ ...employee, password: event.target.value })} /></label><label>PIN (optional)<input inputMode="numeric" pattern="[0-9]{4,8}" value={employee.pin} onChange={(event) => setEmployee({ ...employee, pin: event.target.value })} /></label><label>Role<select required value={employee.roleId} onChange={(event) => setEmployee({ ...employee, roleId: event.target.value })}><option value="">Select a role</option>{people.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><button className="primary">Create employee</button><div className="people-list employee-credential-list">{people.employees.map((person) => { const draft = credentialDrafts[person.id] ?? { password: "", pin: "" }; const identity = employeeIdentityDrafts[person.id] ?? { name: person.name, email: person.email }; return <article key={person.id}><div className="employee-summary"><strong>{person.name}</strong><span>{person.email} · {person.employeeRoles.map((entry) => entry.role.name).join(", ")}</span><div className="employee-identity-fields"><label>Name<input required maxLength={100} value={identity.name} onChange={(event) => setEmployeeIdentityDrafts((current) => ({ ...current, [person.id]: { ...identity, name: event.target.value } }))} /></label><label>Email<input required type="email" value={identity.email} onChange={(event) => setEmployeeIdentityDrafts((current) => ({ ...current, [person.id]: { ...identity, email: event.target.value } }))} /></label><button type="button" className="secondary" disabled={identity.name === person.name && identity.email === person.email} onClick={() => void saveEmployeeIdentity(person)}>Save profile</button></div><div className="credential-reset-fields"><label>Temporary password<input type="password" minLength={12} value={draft.password} onChange={(event) => setCredentialDrafts((current) => ({ ...current, [person.id]: { ...draft, password: event.target.value } }))} /></label><button type="button" className="secondary" onClick={() => void resetEmployeeCredentials(person, "password")}>Reset password</button><label>New PIN<input inputMode="numeric" pattern="[0-9]{4,8}" value={draft.pin} onChange={(event) => setCredentialDrafts((current) => ({ ...current, [person.id]: { ...draft, pin: event.target.value } }))} /></label><button type="button" className="secondary" onClick={() => void resetEmployeeCredentials(person, "pin")}>Set PIN</button><button type="button" className="secondary" onClick={() => void resetEmployeeCredentials(person, "pin", true)}>Remove PIN</button></div></div><button type="button" className="secondary" onClick={() => void toggleEmployee(person)}>{person.active ? "Deactivate" : "Reactivate"}</button></article>; })}</div></form>
      {canPermissions && <div className="panel"><p className="kicker">EMPLOYEE ROLES</p><h2>Assign roles</h2><form className="custom-role-form" onSubmit={(event) => void createRole(event)}><label>New role name<input required maxLength={100} value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} placeholder="Floor manager" /></label><button className="secondary">Create role</button></form><div className="role-assignment-list">{people.employees.map((person) => <article key={person.id}><strong>{person.name}</strong><div className="permission-list">{people.roles.map((role) => <label className="checkbox" key={role.id}><input type="checkbox" checked={(employeeRoleDrafts[person.id] ?? []).includes(role.id)} onChange={(event) => setEmployeeRoleDrafts((current) => ({ ...current, [person.id]: event.target.checked ? [...(current[person.id] ?? []), role.id] : (current[person.id] ?? []).filter((id) => id !== role.id) }))} /><span>{role.name}</span></label>)}</div><button className="secondary" type="button" onClick={() => void saveEmployeeRoles(person)}>Save roles</button></article>)}</div><hr /><p className="kicker">PERMISSIONS</p><h2>Role access</h2><label>Role<select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>{people.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>{selectedRole?.key.startsWith("CUSTOM_") && <div className="custom-role-form role-lifecycle"><label>Custom role name<input required maxLength={100} value={selectedRoleName} onChange={(event) => setSelectedRoleName(event.target.value)} /></label><button type="button" className="secondary" disabled={!selectedRoleName.trim() || selectedRoleName.trim() === selectedRole.name} onClick={() => void renameRole()}>Rename</button><button type="button" className="danger" onClick={() => void deleteRole()}>Delete</button></div>}<div className="permission-groups">{groupedPermissions.map((group) => { const keys = group.permissions.map((permission) => permission.key); const allSelected = keys.every((key) => selectedPermissions.includes(key)); return <section className="permission-group" key={group.label}><div className="permission-group-heading"><div><h3>{group.label}</h3><small>{keys.filter((key) => selectedPermissions.includes(key)).length} of {keys.length} enabled</small></div><button type="button" className="secondary" onClick={() => setPermissionGroup(keys, !allSelected)}>{allSelected ? "Clear group" : "Select group"}</button></div><div className="permission-list">{group.permissions.map((permission) => <label className="checkbox" key={permission.id}><input type="checkbox" checked={selectedPermissions.includes(permission.key)} onChange={(event) => setSelectedPermissions(event.target.checked ? [...selectedPermissions, permission.key] : selectedPermissions.filter((key) => key !== permission.key))} /><span><strong>{permission.key}</strong><small>{permission.description}</small></span></label>)}</div></section>; })}</div><button className="primary" onClick={() => void saveRole()}>Save role permissions</button></div>}
    </section>}

    {people && section === "users" && <section className="panel"><p className="kicker">ACCOUNT SECURITY</p><h2>Authenticator recovery</h2><p className="muted">Reset two-step verification only when an employee has lost or replaced their authenticator device. They will be required to scan a new QR code at their next sign-in.</p><div className="people-list">{people.employees.map((person) => <article key={`mfa-${person.id}`}><div><strong>{person.name}</strong><span>{person.email} · {person.authAccount?.mfaEnabled ? "MFA enabled" : "MFA not enrolled"}</span></div><button type="button" className="secondary" disabled={!person.authAccount?.mfaEnabled} onClick={() => void resetEmployeeMfa(person)}>Reset MFA</button></article>)}</div></section>}

    {refunds && <RefundWorkbench
      refunds={refunds}
      history={refundHistory}
      refundReason={refundReason}
      drawerId={drawerId}
      query={refundQuery}
      onReasonChange={setRefundReason}
      onDrawerChange={setDrawerId}
      onQueryChange={setRefundQuery}
      onSearch={() => void refresh()}
      historyFrom={historyFrom}
      historyTo={historyTo}
      onHistoryFromChange={setHistoryFrom}
      onHistoryToChange={setHistoryTo}
      onRefund={(scope, id, cashRequired) => void refund(scope, id, cashRequired)}
    />}
  </section>;
}

function RefundWorkbench({ refunds, history, refundReason, drawerId, query, historyFrom, historyTo, onReasonChange, onDrawerChange, onQueryChange, onHistoryFromChange, onHistoryToChange, onSearch, onRefund }: {
  refunds: Refunds;
  history: Refunds | null;
  refundReason: string;
  drawerId: string;
  query: string;
  historyFrom: string;
  historyTo: string;
  onReasonChange: (value: string) => void;
  onDrawerChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onHistoryFromChange: (value: string) => void;
  onHistoryToChange: (value: string) => void;
  onSearch: () => void;
  onRefund: (scope: "ticket" | "restaurant", id: string, cashRequired?: boolean) => void;
}) {
  const ticketOrders = [...refunds.ticketOrders].sort((left, right) => Number(ticketNeedsAttention(right)) - Number(ticketNeedsAttention(left)));
  const restaurantTabs = [...refunds.restaurantTabs].sort((left, right) => Number(tabNeedsAttention(right)) - Number(tabNeedsAttention(left)));
  const attentionCount = ticketOrders.filter(ticketNeedsAttention).length + restaurantTabs.filter(tabNeedsAttention).length;

  return <section className="panel refund-workbench">
    <p className="kicker">REFUNDS</p>
    <div className="refund-heading">
      <div><h2>Full-refund workbench</h2><p className="muted">Attention items stay at the top and retain their processor-attempt history.</p></div>
      <strong className={attentionCount ? "attention-summary" : "status-chip"}>{attentionCount ? `${attentionCount} need attention` : "No attention items"}</strong>
    </div>
    <form className="refund-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
      <label>Find an order or guest<input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Order number, receipt, name, or email" /></label>
      <button className="secondary">Search</button>
    </form>
    <div className="two-fields">
      <label>Reason<input value={refundReason} onChange={(event) => onReasonChange(event.target.value)} /></label>
      <label>Open cash drawer ID (cash ticket sales only)<input value={drawerId} onChange={(event) => onDrawerChange(event.target.value)} /></label>
    </div>
    <h3>Ticket orders</h3>
    <div className="refund-list">{ticketOrders.map((order) => {
      const cashRequired = order.cashTransactions.some((entry) => entry.type === "SALE" && entry.amountCents > 0);
      const needsAttention = ticketNeedsAttention(order);
      return <article className={needsAttention ? "refund-attention" : undefined} key={order.id}>
        <div><strong>{order.orderNumber} · {money(order.totalCents)}</strong><span>{order.guestName || order.guestEmail || "Walk-up customer"} · {order.tickets[0]?.showtimeSeat.showtime.movie.title} · {order.tickets.map((ticket) => ticket.showtimeSeat.seat.label).join(", ")}</span>
          <div className="status-row"><b className={needsAttention ? "status-alert" : "status-chip"}>Order {order.status}</b><b className={needsAttention ? "status-alert" : "status-chip"}>Payment {order.payment?.status ?? "CASH"}</b>{order.payment?.refunds.map((attempt, index) => <RefundAttemptBadge attempt={attempt} key={`${attempt.createdAt}-${index}`} />)}{order.payment?.verificationFailureNote && <small>{order.payment.verificationFailureNote}</small>}</div>
        </div>
        <button className={needsAttention ? "primary" : "destructive"} onClick={() => onRefund("ticket", order.id, cashRequired)}>{needsAttention ? "Retry refund" : "Full refund"}</button>
      </article>;
    })}</div>
    {!ticketOrders.length && <p className="muted">No refundable ticket orders match this search.</p>}
    <h3>Restaurant tabs</h3>
    <div className="refund-list">{restaurantTabs.map((tab) => {
      const needsAttention = tabNeedsAttention(tab);
      return <article className={needsAttention ? "refund-attention" : undefined} key={tab.id}>
        <div><strong>{tab.receipt?.receiptNumber ?? tab.label ?? "Restaurant tab"} · {money(tab.totalCents ?? 0)}</strong><span>{tab.primaryCustomer?.name || tab.primaryCustomer?.email || "Guest"} · {tab.showtime?.movie.title ?? "Walk-in"}</span>
          <div className="status-row"><b className={needsAttention ? "status-alert" : "status-chip"}>Tab {tab.status}</b>{tab.payments.map((payment, index) => <b key={index} className={payment.status === "FAILED" ? "status-alert" : "status-chip"}>Tender {payment.status}</b>)}{tab.payments.flatMap((payment) => payment.refunds).map((attempt, index) => <RefundAttemptBadge attempt={attempt} key={`${attempt.createdAt}-${index}`} />)}</div>
        </div>
        <button className={needsAttention ? "primary" : "destructive"} onClick={() => onRefund("restaurant", tab.id)}>{needsAttention ? "Retry refund" : "Full refund"}</button>
      </article>;
    })}</div>
    {!restaurantTabs.length && <p className="muted">No refundable restaurant tabs match this search.</p>}
    <hr />
    <h3>Completed refund history</h3>
    <form className="refund-history-filters" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
      <label>From<input type="date" value={historyFrom} onChange={(event) => onHistoryFromChange(event.target.value)} /></label>
      <label>To<input type="date" value={historyTo} onChange={(event) => onHistoryToChange(event.target.value)} /></label>
      <button className="secondary">Refresh history</button>
    </form>
    <RefundHistoryList history={history} />
  </section>;
}

function RefundHistoryList({ history }: { history: Refunds | null }) {
  if (!history) return null;
  return <div className="refund-list refund-history-list">
    {history.ticketOrders.map((order) => <article key={`ticket-${order.id}`}><div><strong>{order.orderNumber} · {money(order.totalCents)}</strong><span>Ticket order · {order.guestName || order.guestEmail || "Walk-up customer"} · {order.tickets[0]?.showtimeSeat.showtime.movie.title ?? "Film"}</span><div className="status-row">{order.payment?.refunds.map((attempt, index) => <RefundAttemptBadge attempt={attempt} key={`${attempt.createdAt}-${index}`} />)}{order.cashTransactions.map((entry, index) => <b className="status-chip" key={index}>Cash refund {money(entry.amountCents)}</b>)}</div></div></article>)}
    {history.restaurantTabs.map((tab) => <article key={`restaurant-${tab.id}`}><div><strong>{tab.receipt?.receiptNumber ?? tab.label ?? "Restaurant tab"} · {money(tab.totalCents ?? 0)}</strong><span>Restaurant · {tab.primaryCustomer?.name || tab.primaryCustomer?.email || "Guest"} · {tab.showtime?.movie.title ?? "Walk-in"}</span><div className="status-row">{tab.payments.flatMap((payment) => payment.refunds).map((attempt, index) => <RefundAttemptBadge attempt={attempt} key={`${attempt.createdAt}-${index}`} />)}</div></div></article>)}
    {!history.ticketOrders.length && !history.restaurantTabs.length && <p className="muted">No completed refunds match this search and date range.</p>}
  </div>;
}

function RefundAttemptBadge({ attempt }: { attempt: RefundAttempt }) {
  const attention = unresolvedRefund(attempt.status);
  const details = [money(attempt.amountCents), new Date(attempt.createdAt).toLocaleString(), attempt.reason].filter(Boolean).join(" · ");
  return <b className={attention ? "status-alert" : "status-chip"} title={details}>Refund {attempt.status}</b>;
}
