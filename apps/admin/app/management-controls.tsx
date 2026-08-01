"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Settings = { taxRules: Array<{ id: string; name: string; appliesTo: string; ratePermille: number; active: boolean }>; serviceChargeRules: Array<{ id: string; name: string; appliesTo: string; ratePermille: number | null; flatCents: number | null; active: boolean }> };
type People = {
  employees: Array<{ id: string; name: string; email: string; active: boolean; employeeRoles: Array<{ roleId: string; role: { key: string; name: string } }> }>;
  roles: Array<{ id: string; key: string; name: string; rolePermissions: Array<{ permission: { key: string } }> }>;
  permissions: Array<{ id: string; key: string; description: string }>;
};
type Refunds = {
  ticketOrders: Array<{ id: string; orderNumber: string; totalCents: number; guestName: string | null; guestEmail: string | null; tickets: Array<{ id: string; showtimeSeat: { seat: { label: string }; showtime: { movie: { title: string } } } }>; cashTransactions: Array<{ type: string; amountCents: number }> }>;
  restaurantTabs: Array<{ id: string; label: string | null; totalCents: number | null; primaryCustomer: { name: string | null; email: string | null } | null; showtime: { movie: { title: string } } | null; receipt: { receiptNumber: string } | null }>;
};

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function ManagementControls({ accessToken, permissions }: { accessToken: string; permissions: string[] }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [refunds, setRefunds] = useState<Refunds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tax, setTax] = useState({ name: "", appliesTo: "ALL", ratePermille: 0 });
  const [charge, setCharge] = useState({ name: "", appliesTo: "ALL", ratePermille: 0 });
  const [employee, setEmployee] = useState({ name: "", email: "", password: "", pin: "", roleId: "" });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [refundReason, setRefundReason] = useState("Customer-requested full refund");
  const [drawerId, setDrawerId] = useState("");
  const canConfig = permissions.includes("ticket.price.edit");
  const canMenuConfig = permissions.includes("menu.edit");
  const canPeople = permissions.includes("employee.edit");
  const canPermissions = permissions.includes("employee.permissions.edit");
  const canRefund = permissions.includes("payment.refund") || permissions.includes("ticket.refund");

  async function refresh() {
    try {
      const [nextSettings, nextPeople, nextRefunds] = await Promise.all([
        canConfig ? apiFetch<Settings>("/management/settings", { accessToken }) : null,
        canPeople ? apiFetch<People>("/management/people", { accessToken }) : null,
        canRefund ? apiFetch<Refunds>("/management/refunds", { accessToken }) : null,
      ]);
      setSettings(nextSettings); setPeople(nextPeople); setRefunds(nextRefunds);
      if (nextPeople && !selectedRoleId) setSelectedRoleId(nextPeople.roles[0]?.id ?? "");
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Management controls could not be loaded."); }
  }
  useEffect(() => { void refresh(); }, [accessToken]);

  const selectedRole = useMemo(() => people?.roles.find((role) => role.id === selectedRoleId), [people, selectedRoleId]);
  useEffect(() => { setSelectedPermissions(selectedRole?.rolePermissions.map((entry) => entry.permission.key) ?? []); }, [selectedRole]);

  async function createTax(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/settings/tax-rules", { accessToken, method: "POST", body: JSON.stringify({ ...tax, active: true }) }); setTax({ name: "", appliesTo: "ALL", ratePermille: 0 }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function createCharge(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/settings/service-charge-rules", { accessToken, method: "POST", body: JSON.stringify({ ...charge, active: true, autoApply: true }) }); setCharge({ name: "", appliesTo: "ALL", ratePermille: 0 }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function createEmployee(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await apiFetch("/management/employees", { accessToken, method: "POST", body: JSON.stringify({ name: employee.name, email: employee.email, password: employee.password, pin: employee.pin || undefined, roleIds: [employee.roleId] }) }); setEmployee({ name: "", email: "", password: "", pin: "", roleId: "" }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function saveRole() {
    if (!selectedRoleId) return;
    try { await apiFetch(`/management/roles/${selectedRoleId}/permissions`, { accessToken, method: "PATCH", body: JSON.stringify({ permissionKeys: selectedPermissions }) }); await refresh(); } catch (reason) { showError(reason); }
  }
  async function toggleEmployee(target: People["employees"][number]) {
    try { await apiFetch(`/management/employees/${target.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ active: !target.active }) }); await refresh(); } catch (reason) { showError(reason); }
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
    {(canConfig || canMenuConfig) && <section className="admin-grid">
      {canMenuConfig && <form className="panel" onSubmit={(event) => void createTax(event)}><p className="kicker">TAX RULES</p><h2>Add restaurant tax</h2><label>Name<input required value={tax.name} onChange={(event) => setTax({ ...tax, name: event.target.value })} /></label><label>Category<select value={tax.appliesTo} onChange={(event) => setTax({ ...tax, appliesTo: event.target.value })}><option value="ALL">All</option><option value="FOOD">Food</option><option value="ALCOHOL">Alcohol</option><option value="NA_BEVERAGE">Non-alcoholic beverage</option></select></label><label>Rate in tenths of a percent<input type="number" min="0" max="1000" value={tax.ratePermille} onChange={(event) => setTax({ ...tax, ratePermille: Number(event.target.value) })} /></label><button className="primary">Add tax rule</button><ul>{settings?.taxRules.map((rule) => <li key={rule.id}>{rule.name} · {(rule.ratePermille / 10).toFixed(1)}% · {rule.appliesTo}</li>)}</ul></form>}
      {canMenuConfig && <form className="panel" onSubmit={(event) => void createCharge(event)}><p className="kicker">SERVICE CHARGES</p><h2>Add automatic charge</h2><label>Name<input required value={charge.name} onChange={(event) => setCharge({ ...charge, name: event.target.value })} /></label><label>Category<select value={charge.appliesTo} onChange={(event) => setCharge({ ...charge, appliesTo: event.target.value })}><option value="ALL">All</option><option value="FOOD">Food</option><option value="ALCOHOL">Alcohol</option><option value="NA_BEVERAGE">Non-alcoholic beverage</option></select></label><label>Rate in tenths of a percent<input type="number" min="0" max="1000" value={charge.ratePermille} onChange={(event) => setCharge({ ...charge, ratePermille: Number(event.target.value) })} /></label><button className="primary">Add service charge</button><ul>{settings?.serviceChargeRules.map((rule) => <li key={rule.id}>{rule.name} · {rule.ratePermille != null ? `${(rule.ratePermille / 10).toFixed(1)}%` : money(rule.flatCents ?? 0)}</li>)}</ul></form>}
    </section>}

    {people && <section className="admin-grid"><form className="panel" onSubmit={(event) => void createEmployee(event)}><p className="kicker">USERS</p><h2>Add employee</h2><label>Name<input required value={employee.name} onChange={(event) => setEmployee({ ...employee, name: event.target.value })} /></label><label>Email<input type="email" required value={employee.email} onChange={(event) => setEmployee({ ...employee, email: event.target.value })} /></label><label>Temporary password<input type="password" minLength={12} required value={employee.password} onChange={(event) => setEmployee({ ...employee, password: event.target.value })} /></label><label>PIN (optional)<input inputMode="numeric" pattern="[0-9]{4,8}" value={employee.pin} onChange={(event) => setEmployee({ ...employee, pin: event.target.value })} /></label><label>Role<select required value={employee.roleId} onChange={(event) => setEmployee({ ...employee, roleId: event.target.value })}><option value="">Select a role</option>{people.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><button className="primary">Create employee</button><div className="people-list">{people.employees.map((person) => <article key={person.id}><div><strong>{person.name}</strong><span>{person.email} · {person.employeeRoles.map((entry) => entry.role.name).join(", ")}</span></div><button type="button" className="secondary" onClick={() => void toggleEmployee(person)}>{person.active ? "Deactivate" : "Reactivate"}</button></article>)}</div></form>
      {canPermissions && <div className="panel"><p className="kicker">PERMISSIONS</p><h2>Role access</h2><label>Role<select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>{people.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><div className="permission-list">{people.permissions.map((permission) => <label className="checkbox" key={permission.id}><input type="checkbox" checked={selectedPermissions.includes(permission.key)} onChange={(event) => setSelectedPermissions(event.target.checked ? [...selectedPermissions, permission.key] : selectedPermissions.filter((key) => key !== permission.key))} /><span><strong>{permission.key}</strong><small>{permission.description}</small></span></label>)}</div><button className="primary" onClick={() => void saveRole()}>Save role permissions</button></div>}
    </section>}

    {refunds && <section className="panel"><p className="kicker">REFUNDS</p><h2>Full-refund workbench</h2><div className="two-fields"><label>Reason<input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} /></label><label>Open cash drawer ID (cash ticket sales only)<input value={drawerId} onChange={(event) => setDrawerId(event.target.value)} /></label></div><h3>Ticket orders</h3><div className="refund-list">{refunds.ticketOrders.map((order) => { const cashRequired = order.cashTransactions.some((entry) => entry.type === "SALE" && entry.amountCents > 0); return <article key={order.id}><div><strong>{order.orderNumber} · {money(order.totalCents)}</strong><span>{order.guestName || order.guestEmail || "Walk-up customer"} · {order.tickets[0]?.showtimeSeat.showtime.movie.title} · {order.tickets.map((ticket) => ticket.showtimeSeat.seat.label).join(", ")}</span></div><button className="destructive" onClick={() => void refund("ticket", order.id, cashRequired)}>Full refund</button></article>; })}</div><h3>Restaurant tabs</h3><div className="refund-list">{refunds.restaurantTabs.map((tab) => <article key={tab.id}><div><strong>{tab.receipt?.receiptNumber ?? tab.label ?? "Restaurant tab"} · {money(tab.totalCents ?? 0)}</strong><span>{tab.primaryCustomer?.name || tab.primaryCustomer?.email || "Guest"} · {tab.showtime?.movie.title ?? "Walk-in"}</span></div><button className="destructive" onClick={() => void refund("restaurant", tab.id)}>Full refund</button></article>)}</div></section>}
  </section>;
}
