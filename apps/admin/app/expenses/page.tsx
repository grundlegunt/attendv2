"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";
import { inclusiveReportRange, localDateInputValue } from "../report-range";

const categories = ["FILM_RENTAL", "FOOD_BEVERAGE", "PAYROLL", "OCCUPANCY", "MARKETING", "EQUIPMENT", "MAINTENANCE", "UTILITIES", "INSURANCE", "OTHER"] as const;
type ExpenseCategory = (typeof categories)[number];
type Expense = { id: string; category: ExpenseCategory; vendor: string | null; description: string; amountCents: number; incurredAt: string; notes: string | null };
type ExpenseReport = { totals: { totalExpenseCents: number; count: number; byCategory: Record<string, number> }; rows: Expense[] };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const categoryLabel = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export default function ExpensesPage() {
  const { accessToken, employee } = useAdminSession();
  const timeZone = employee.timezone;
  const today = useMemo(() => new Date(), []);
  const currentDateKey = localDateInputValue(today, timeZone);
  const [from, setFrom] = useState(`${currentDateKey.slice(0, 8)}01`);
  const [through, setThrough] = useState(currentDateKey);
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>("FILM_RENTAL");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredAt, setIncurredAt] = useState(currentDateKey);
  const [notes, setNotes] = useState("");
  const mutationPendingRef = useRef(false);
  const expenseAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deleteExpenseAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const query = useMemo(() => new URLSearchParams(inclusiveReportRange(from, through, timeZone)).toString(), [from, through, timeZone]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setReport(await apiFetch<ExpenseReport>(`/reports/expenses?${query}`, { accessToken })); }
    catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Expenses could not be loaded."); }
    finally { setLoading(false); }
  }, [accessToken, query]);

  useEffect(() => { void load(); }, [load]);

  async function createExpense(event: FormEvent) {
    event.preventDefault(); setError(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) { setError("Enter an expense amount greater than zero."); return; }
    if (mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setSaving(true);
    const incurredRange = inclusiveReportRange(incurredAt, incurredAt, timeZone);
    const incurredAtInstant = new Date((Date.parse(incurredRange.from) + Date.parse(incurredRange.to)) / 2).toISOString();
    const payload = { category, vendor: vendor || undefined, description, amountCents, incurredAt: incurredAtInstant, notes: notes || undefined };
    const fingerprint = JSON.stringify(payload);
    if (expenseAttemptRef.current?.fingerprint !== fingerprint) expenseAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/reports/expenses", { accessToken, method: "POST", headers: { "Idempotency-Key": expenseAttemptRef.current.requestId }, body: fingerprint });
      expenseAttemptRef.current = null;
      setVendor(""); setDescription(""); setAmount(""); setNotes("");
      await load();
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status < 500) expenseAttemptRef.current = null; setError(reason instanceof ApiRequestError ? reason.body.message : "The expense could not be saved."); }
    finally { mutationPendingRef.current = false; setSaving(false); }
  }

  async function removeExpense(expense: Expense) {
    if (mutationPendingRef.current) return;
    if (!window.confirm(`Delete ${expense.description}?`)) return;
    mutationPendingRef.current = true;
    setDeletingExpenseId(expense.id);
    setError(null);
    if (deleteExpenseAttemptRef.current?.fingerprint !== expense.id) deleteExpenseAttemptRef.current = { fingerprint: expense.id, requestId: crypto.randomUUID() };
    try { await apiFetch(`/reports/expenses/${expense.id}`, { accessToken, method: "DELETE", headers: { "Idempotency-Key": deleteExpenseAttemptRef.current.requestId } }); deleteExpenseAttemptRef.current = null; await load(); }
    catch (reason) { if (reason instanceof ApiRequestError && reason.status < 500) deleteExpenseAttemptRef.current = null; setError(reason instanceof ApiRequestError ? reason.body.message : "The expense could not be deleted."); }
    finally { mutationPendingRef.current = false; setDeletingExpenseId(null); }
  }

  async function downloadCsv() {
    try {
      const blob = await apiDownload(`/reports/expenses.csv?${query}`, { accessToken });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `expenses-${from}-through-${through}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The export could not be downloaded."); }
  }

  return <main className="admin-shell expense-page">
    <header className="dashboard-heading"><div><p className="kicker">FINANCIAL REPORTS</p><h1>Expenses</h1><p>Track cinema operating costs and export the ledger for accounting.</p></div><button className="secondary" type="button" onClick={() => void downloadCsv()}>Export CSV</button></header>
    {error && <div className="error-banner">{error}</div>}
    <section className="panel expense-filters"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" value={through} min={from} onChange={(event) => setThrough(event.target.value)} /></label><button className="secondary" type="button" onClick={() => void load()}>Refresh</button></section>
    <section className="dashboard-metrics"><article className="dashboard-metric"><span>Total expenses</span><strong>{money.format((report?.totals.totalExpenseCents ?? 0) / 100)}</strong><small>{report?.totals.count ?? 0} entries in this period</small></article>{Object.entries(report?.totals.byCategory ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cents]) => <article className="dashboard-metric" key={name}><span>{categoryLabel(name)}</span><strong>{money.format(cents / 100)}</strong><small>Category total</small></article>)}</section>
    <div className="expense-layout"><form className="panel expense-form" onSubmit={createExpense}><p className="kicker">NEW ENTRY</p><h2>Add expense</h2><label>Date<input required type="date" value={incurredAt} disabled={saving || deletingExpenseId !== null} onChange={(event) => setIncurredAt(event.target.value)} /></label><label>Category<select value={category} disabled={saving || deletingExpenseId !== null} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{categories.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label><label>Vendor<input maxLength={160} value={vendor} disabled={saving || deletingExpenseId !== null} onChange={(event) => setVendor(event.target.value)} /></label><label>Description<input required maxLength={240} value={description} disabled={saving || deletingExpenseId !== null} onChange={(event) => setDescription(event.target.value)} /></label><label>Amount<input required min="0.01" step="0.01" inputMode="decimal" type="number" value={amount} disabled={saving || deletingExpenseId !== null} onChange={(event) => setAmount(event.target.value)} /></label><label>Notes<textarea maxLength={2000} rows={4} value={notes} disabled={saving || deletingExpenseId !== null} onChange={(event) => setNotes(event.target.value)} /></label><button className="primary" disabled={saving || deletingExpenseId !== null}>{saving ? "Saving…" : "Add expense"}</button></form>
      <section className="panel expense-ledger"><div className="dashboard-section-heading"><div><p className="kicker">LEDGER</p><h2>Expense entries</h2></div></div>{loading ? <p className="muted">Loading expenses…</p> : !report?.rows.length ? <p className="dashboard-empty">No expenses were entered for this period.</p> : <div className="expense-list">{report.rows.map((expense) => <article key={expense.id}><time>{new Date(expense.incurredAt).toLocaleDateString()}</time><span><strong>{expense.description}</strong><small>{categoryLabel(expense.category)}{expense.vendor ? ` · ${expense.vendor}` : ""}{expense.notes ? ` · ${expense.notes}` : ""}</small></span><b>{money.format(expense.amountCents / 100)}</b><button className="secondary" type="button" disabled={saving || deletingExpenseId !== null} onClick={() => void removeExpense(expense)}>{deletingExpenseId === expense.id ? "Deleting…" : "Delete"}</button></article>)}</div>}</section>
    </div>
  </main>;
}
