"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type AttentionInbox = {
  boxOfficeOrders: Array<{ id: string; orderNumber: string; totalCents: number; currency: string; guestName: string | null; guestEmail: string | null; updatedAt: string; customer: { id: string; name: string | null; email: string | null } | null }>;
  restaurantTabs: Array<{ id: string; label: string | null; status: string; totalCents: number | null; updatedAt: string; location: { currency: string }; primaryCustomer: { id: string; name: string | null; email: string | null } | null; showtime: { movie: { title: string }; auditorium: { name: string } } | null }>;
  failedRefunds: Array<{ id: string; amountCents: number; reason: string; scope: string; updatedAt: string; payment: { currency: string; ticketOrder: { orderNumber: string } | null; restaurantTab: { id: string; label: string | null } | null } }>;
  privateEventInquiries: Array<{ id: string; name: string; email: string; eventType: string; preferredDate: string | null; guestCount: number | null; createdAt: string }>;
};

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

export default function AttentionPage() {
  const { accessToken, employee } = useAdminSession();
  const [inbox, setInbox] = useState<AttentionInbox | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<AttentionInbox>("/management/attention", { accessToken, signal: controller.signal })
      .then((next) => { setInbox(next); setError(null); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "Attention items could not be loaded."); });
    return () => controller.abort();
  }, [accessToken]);

  const count = useMemo(() => inbox ? inbox.boxOfficeOrders.length + inbox.restaurantTabs.length + inbox.failedRefunds.length + inbox.privateEventInquiries.length : 0, [inbox]);
  const when = (value: string) => new Date(value).toLocaleString([], { timeZone: employee.timezone });

  return <main className="admin-route-page"><section className="panel attention-inbox"><p className="kicker">ACTION REQUIRED</p><h2>Manager attention</h2><p>Operational exceptions that need a person to follow up. Revenue and performance metrics remain on the Dashboard and Reports pages.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!inbox && !error && <p>Loading attention items…</p>}
    {inbox && <><div className={count ? "attention-summary" : "status-chip"}>{count ? `${count} items need attention` : "No attention items"}</div>
      <div className="attention-sections">
        <section><h3>Box-office payment failures <span>{inbox.boxOfficeOrders.length}</span></h3>{inbox.boxOfficeOrders.map((order) => <article key={order.id}><div><strong>{order.orderNumber}</strong><small>{order.customer?.name ?? order.guestName ?? "Guest"} · {order.customer?.email ?? order.guestEmail ?? "No email"} · {when(order.updatedAt)}</small></div><strong>{money(order.totalCents, order.currency)}</strong><div className="search-result-actions">{order.customer && <Link href={`/customers/${encodeURIComponent(order.customer.id)}`}>Open customer</Link>}<Link href={`/refunds?query=${encodeURIComponent(order.orderNumber)}`}>Resolve</Link></div></article>)}{!inbox.boxOfficeOrders.length && <p className="dashboard-empty">No failed box-office orders.</p>}</section>
        <section><h3>Restaurant settlement <span>{inbox.restaurantTabs.length}</span></h3>{inbox.restaurantTabs.map((tab) => <article key={tab.id}><div><strong>{tab.label ?? tab.showtime?.movie.title ?? "Restaurant tab"}</strong><small>{tab.primaryCustomer?.name ?? tab.primaryCustomer?.email ?? tab.showtime?.auditorium.name ?? "Guest"} · {tab.status.replaceAll("_", " ")} · {when(tab.updatedAt)}</small></div>{tab.totalCents != null && <strong>{money(tab.totalCents, tab.location.currency)}</strong>}<div className="search-result-actions">{tab.primaryCustomer && <Link href={`/customers/${encodeURIComponent(tab.primaryCustomer.id)}`}>Open customer</Link>}<Link href="/refunds">Resolve</Link></div></article>)}{!inbox.restaurantTabs.length && <p className="dashboard-empty">No restaurant checks need review.</p>}</section>
        <section><h3>Failed refunds <span>{inbox.failedRefunds.length}</span></h3>{inbox.failedRefunds.map((refund) => <article key={refund.id}><div><strong>{refund.payment.ticketOrder?.orderNumber ?? refund.payment.restaurantTab?.label ?? "Restaurant refund"}</strong><small>{refund.scope} · {refund.reason} · {when(refund.updatedAt)}</small></div><strong>{money(refund.amountCents, refund.payment.currency)}</strong><Link href={refund.payment.ticketOrder ? `/refunds?query=${encodeURIComponent(refund.payment.ticketOrder.orderNumber)}` : "/refunds"}>Retry</Link></article>)}{!inbox.failedRefunds.length && <p className="dashboard-empty">No failed refunds.</p>}</section>
        <section><h3>New private-event inquiries <span>{inbox.privateEventInquiries.length}</span></h3>{inbox.privateEventInquiries.map((inquiry) => <article key={inquiry.id}><div><strong>{inquiry.name} · {inquiry.eventType}</strong><small>{inquiry.email}{inquiry.guestCount ? ` · ${inquiry.guestCount} guests` : ""} · received {when(inquiry.createdAt)}</small></div><Link href="/private-events">Follow up</Link></article>)}{!inbox.privateEventInquiries.length && <p className="dashboard-empty">No unanswered inquiries.</p>}</section>
      </div>
    </>}
  </section></main>;
}
