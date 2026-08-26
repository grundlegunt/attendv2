"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminSession } from "../../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../../lib/api-client";

type Customer = {
  id: string; name: string | null; email: string | null; phone: string | null; isGuest: boolean; createdAt: string;
  membership: { membershipNumber: string; tier: string; status: string; expiresAt: string | null } | null;
  summary: { orderCount: number; ticketCount: number; lifetimeSpendCents: number; currency: string; diningVisitCount: number; diningSpendCents: number; diningCurrency: string; donationCount: number; donationAmountCents: number; donationTaxDeductibleAmountCents: number; donationCurrency: string };
  historyWindow: { ticketOrdersShown: number; ticketOrdersTotal: number; diningVisitsShown: number; diningVisitsTotal: number; donationsShown: number; donationsTotal: number };
  ticketOrders: Array<{ id: string; orderNumber: string; status: string; channel: string; totalCents: number; currency: string; createdAt: string; tickets: Array<{ id: string; status: string; ticketType: { name: string }; showtimeSeat: { seat: { label: string }; showtime: { startsAt: string; movie: { title: string }; auditorium: { name: string } } } }> }>;
  restaurantTabs: Array<{ id: string; label: string | null; status: string; fulfillmentMode: string; totalCents: number | null; prepaidCents: number; openedAt: string; location: { currency: string }; showtime: { movie: { title: string }; auditorium: { name: string } } | null; seats: Array<{ showtimeSeat: { seat: { label: string } } }>; orders: Array<{ items: Array<{ quantity: number; menuItem: { name: string } }> }> }>;
  donations: Array<{ id: string; status: string; amountCents: number; taxDeductibleAmountCents: number; paymentMethod: string; externalReference: string | null; receivedAt: string; campaign: { id: string; name: string } | null; location: { currency: string } }>;
};

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, employee } = useAdminSession();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState<"tickets" | "dining" | "donations" | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    apiFetch<Customer>(`/management/customers/${id}`, { accessToken })
      .then((result) => { if (!cancelled) setCustomer(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Customer profile could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, id]);

  const dateTime = (value: string) => new Date(value).toLocaleString([], { timeZone: employee.timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const date = (value: string) => new Date(value).toLocaleDateString([], { timeZone: employee.timezone, month: "short", day: "numeric", year: "numeric" });
  async function loadOlder(kind: "tickets" | "dining" | "donations") {
    if (!customer || historyLoading) return;
    setHistoryLoading(kind); setError(null);
    const query = new URLSearchParams({ ticketOffset: String(kind === "tickets" ? customer.ticketOrders.length : 0), diningOffset: String(kind === "dining" ? customer.restaurantTabs.length : 0), donationOffset: String(kind === "donations" ? customer.donations.length : 0) });
    try {
      const next = await apiFetch<Customer>(`/management/customers/${id}?${query}`, { accessToken });
      setCustomer((current) => current ? { ...current, ticketOrders: kind === "tickets" ? [...current.ticketOrders, ...next.ticketOrders] : current.ticketOrders, restaurantTabs: kind === "dining" ? [...current.restaurantTabs, ...next.restaurantTabs] : current.restaurantTabs, donations: kind === "donations" ? [...current.donations, ...next.donations] : current.donations, historyWindow: kind === "tickets" ? { ...current.historyWindow, ticketOrdersShown: next.historyWindow.ticketOrdersShown } : kind === "dining" ? { ...current.historyWindow, diningVisitsShown: next.historyWindow.diningVisitsShown } : { ...current.historyWindow, donationsShown: next.historyWindow.donationsShown } } : current);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Older customer history could not be loaded."); }
    finally { setHistoryLoading(null); }
  }
  async function exportHistory() {
    if (!customer || exporting) return;
    setExporting(true); setError(null);
    try {
      const blob = await apiDownload(`/management/customers/${id}/history.csv`, { accessToken });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "customer-history.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Customer history could not be exported."); }
    finally { setExporting(false); }
  }

  return <main className="admin-route-page customer-profile-page">
    <Link href="/search" className="back-link">← Customer search</Link>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading && <p className="dashboard-empty">Loading customer profile…</p>}
    {customer && <>
      <section className="admin-heading"><div><p className="kicker">CUSTOMER PROFILE</p><h1>{customer.name ?? "Guest customer"}</h1><p>{customer.email ?? "No email"}{customer.phone ? ` · ${customer.phone}` : ""}</p></div><button type="button" className="secondary" disabled={exporting} onClick={() => void exportHistory()}>{exporting ? "Exporting…" : "Export history CSV"}</button></section>
      <section className="series-performance-metrics customer-profile-metrics">
        <div><span>Customer type</span><strong>{customer.isGuest ? "Guest" : "Account"}</strong><small>Since {new Date(customer.createdAt).toLocaleDateString([], { timeZone: employee.timezone })}</small></div>
        <div><span>Membership</span><strong>{customer.membership?.tier ?? "None"}</strong><small>{customer.membership ? `#${customer.membership.membershipNumber} · ${customer.membership.status.toLowerCase()}${customer.membership.expiresAt ? ` · Expires ${date(customer.membership.expiresAt)}` : " · No expiration"}` : "No external membership"}</small></div>
        <div><span>Ticket orders</span><strong>{customer.summary.orderCount}</strong><small>{customer.summary.ticketCount} tickets</small></div>
        <div><span>Ticket spend</span><strong>{money(customer.summary.lifetimeSpendCents, customer.summary.currency)}</strong><small>Completed purchases</small></div>
        <div><span>Dining visits</span><strong>{customer.summary.diningVisitCount}</strong><small>{money(customer.summary.diningSpendCents, customer.summary.diningCurrency)} spend</small></div>
        <div><span>Giving</span><strong>{money(customer.summary.donationAmountCents, customer.summary.donationCurrency)}</strong><small>{customer.summary.donationCount} settled · {money(customer.summary.donationTaxDeductibleAmountCents, customer.summary.donationCurrency)} deductible</small></div>
      </section>
      <section className="panel customer-profile-history"><div className="dashboard-section-heading"><div><p className="kicker">TICKETS</p><h2>Ticket order history</h2></div><span>{customer.historyWindow.ticketOrdersShown} of {customer.historyWindow.ticketOrdersTotal}</span></div>
        {customer.ticketOrders.map((order) => <article className="customer-history-order" key={order.id}><div><strong>{order.orderNumber}</strong><small>{dateTime(order.createdAt)} · {order.channel.toLowerCase()} · {order.status.toLowerCase()}</small></div><div>{order.tickets.map((ticket) => <small key={ticket.id}>{ticket.showtimeSeat.showtime.movie.title} · {ticket.showtimeSeat.seat.label} · {ticket.ticketType.name}</small>)}</div><strong>{money(order.totalCents, order.currency)}</strong><Link href={`/refunds?query=${encodeURIComponent(order.orderNumber)}`}>Open order</Link></article>)}
        {!customer.ticketOrders.length && <p className="dashboard-empty">No ticket purchases at this location.</p>}
        {customer.historyWindow.ticketOrdersShown < customer.historyWindow.ticketOrdersTotal && <button type="button" className="secondary history-load-more" disabled={historyLoading !== null} onClick={() => void loadOlder("tickets")}>{historyLoading === "tickets" ? "Loading…" : "Load older ticket orders"}</button>}
      </section>
      <section className="panel customer-profile-history"><div className="dashboard-section-heading"><div><p className="kicker">DINING</p><h2>Food &amp; drink history</h2></div><span>{customer.historyWindow.diningVisitsShown} of {customer.historyWindow.diningVisitsTotal}</span></div>
        {customer.restaurantTabs.map((tab) => <article className="customer-history-order" key={tab.id}><div><strong>{tab.label ?? tab.showtime?.movie.title ?? "Dining visit"}</strong><small>{dateTime(tab.openedAt)} · {tab.fulfillmentMode.replaceAll("_", " ").toLowerCase()} · {tab.status.toLowerCase()}</small></div><div>{tab.orders.flatMap((order) => order.items).map((item, index) => <small key={`${item.menuItem.name}-${index}`}>{item.quantity}× {item.menuItem.name}</small>)}{tab.seats.length > 0 && <small>Seats {tab.seats.map((seat) => seat.showtimeSeat.seat.label).join(", ")}</small>}</div><strong>{tab.totalCents === null ? "Open" : money(tab.totalCents, tab.location.currency)}</strong><span>{tab.showtime?.auditorium.name ?? "Counter"}</span></article>)}
        {!customer.restaurantTabs.length && <p className="dashboard-empty">No dining visits at this location.</p>}
        {customer.historyWindow.diningVisitsShown < customer.historyWindow.diningVisitsTotal && <button type="button" className="secondary history-load-more" disabled={historyLoading !== null} onClick={() => void loadOlder("dining")}>{historyLoading === "dining" ? "Loading…" : "Load older dining visits"}</button>}
      </section>
      <section className="panel customer-profile-history"><div className="dashboard-section-heading"><div><p className="kicker">GIVING</p><h2>Donation history</h2></div><span>{customer.historyWindow.donationsShown} of {customer.historyWindow.donationsTotal}</span></div>
        {customer.donations.map((donation) => <article className="customer-history-order" key={donation.id}><div><strong>{donation.campaign?.name ?? "General support"}</strong><small>{dateTime(donation.receivedAt)} · {donation.paymentMethod.toLowerCase()} · {donation.status.toLowerCase()}</small></div><div><small>{donation.externalReference ? `Reference ${donation.externalReference}` : "No external reference"}</small><small>{money(donation.taxDeductibleAmountCents, donation.location.currency)} tax deductible</small></div><strong>{money(donation.amountCents, donation.location.currency)}</strong>{donation.campaign ? <Link href={`/donations/${donation.campaign.id}`}>Open campaign</Link> : <Link href="/donations">Open giving</Link>}</article>)}
        {!customer.donations.length && <p className="dashboard-empty">No donations at this location.</p>}
        {customer.historyWindow.donationsShown < customer.historyWindow.donationsTotal && <button type="button" className="secondary history-load-more" disabled={historyLoading !== null} onClick={() => void loadOlder("donations")}>{historyLoading === "donations" ? "Loading…" : "Load older donations"}</button>}
      </section>
    </>}
  </main>;
}
