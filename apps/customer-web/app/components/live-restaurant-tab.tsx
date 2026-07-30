"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface LiveTab {
  id: string;
  status: string;
  checkDroppedAt: string | null;
  activePaymentMethod: { id: string; brand: string; last4: string } | null;
  orders: Array<{
    id: string;
    items: Array<{
      id: string;
      quantity: number;
      unitPriceCentsSnapshot: number;
      modifierTotalCents: number;
      menuItem: { name: string };
    }>;
  }>;
  totals: {
    subtotalCents: number;
    taxCents: number;
    serviceChargeCents: number;
    totalCents: number;
  };
  paidCents: number;
  receipt: { receiptNumber: string } | null;
}

export function LiveRestaurantTab({
  tabId,
  accessToken,
  guestToken,
  onClose,
}: {
  tabId?: string;
  accessToken?: string;
  guestToken?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<LiveTab | null>(null);
  const [tipCents, setTipCents] = useState(0);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      setTab(
        await apiFetch<LiveTab>(
          guestToken
            ? `/public/restaurant-tabs/${guestToken}`
            : `/customer/restaurant-tabs/${tabId}`,
          {
          accessToken,
          },
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof ApiRequestError
          ? error.body.message
          : "Your live tab is unavailable.",
      );
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [tabId, accessToken, guestToken]);

  async function chooseTip(value: number) {
    setTipCents(value);
    await apiFetch(
      guestToken
        ? `/public/restaurant-tabs/${guestToken}/tip`
        : `/customer/restaurant-tabs/${tabId}/tip`,
      {
      method: "POST",
      accessToken,
      body: JSON.stringify({ tipCents: value }),
      },
    );
    await refresh();
  }

  async function pay() {
    if (!tab?.activePaymentMethod) {
      return setMessage("Ask your server to collect a different card at the table.");
    }
    try {
      const result = await apiFetch<{ status: string }>(
        guestToken
          ? `/public/restaurant-tabs/${guestToken}/pay`
          : `/customer/restaurant-tabs/${tabId}/pay`,
        {
          method: "POST",
          accessToken,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            tipCents,
            paymentMethodReferenceId: tab.activePaymentMethod.id,
          }),
        },
      );
      setMessage(
        result.status === "CLOSED"
          ? "Paid. Your receipt is ready."
          : "Payment needs attention. Your server has been notified.",
      );
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiRequestError
          ? error.body.message
          : "Payment could not be completed.",
      );
    }
  }

  if (!tab) {
    return (
      <section className="account-panel">
        <button className="link" onClick={onClose}>Back</button>
        <p>{message || "Loading your tab…"}</p>
      </section>
    );
  }
  return (
    <section className="account-panel">
      <button className="link" onClick={onClose}>Back to showtimes</button>
      <h2>Your live tab</h2>
      <p>
        {tab.checkDroppedAt
          ? "Your check has been dropped. You can pay here or with your server."
          : "Your tab is still open."}
      </p>
      {tab.orders.flatMap((order) =>
        order.items.map((item) => (
          <div key={item.id}>
            {item.quantity}× {item.menuItem.name}
            <strong>
              {" "}${(
                ((item.unitPriceCentsSnapshot + item.modifierTotalCents) *
                  item.quantity) /
                100
              ).toFixed(2)}
            </strong>
          </div>
        )),
      )}
      <p>Subtotal ${(tab.totals.subtotalCents / 100).toFixed(2)}</p>
      <p>Tax ${(tab.totals.taxCents / 100).toFixed(2)}</p>
      <p>Service charge ${(tab.totals.serviceChargeCents / 100).toFixed(2)}</p>
      <div>
        {[18, 20, 22].map((percent) => {
          const value = Math.round((tab.totals.subtotalCents * percent) / 100);
          return (
            <button
              className="secondary"
              key={percent}
              onClick={() => void chooseTip(value)}
            >
              {percent}%
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>Custom tip (cents)</span>
        <input
          type="number"
          min="0"
          value={tipCents}
          onChange={(event) => setTipCents(Number(event.target.value))}
          onBlur={() => void chooseTip(tipCents)}
        />
      </label>
      <h3>
        Total ${((tab.totals.totalCents - tab.paidCents) / 100).toFixed(2)}
      </h3>
      {tab.status !== "CLOSED" && (
        <button className="primary" onClick={pay}>Pay & close tab</button>
      )}
      {tab.receipt && <p>Receipt {tab.receipt.receiptNumber}</p>}
      {message && <div className="error-banner">{message}</div>}
    </section>
  );
}
