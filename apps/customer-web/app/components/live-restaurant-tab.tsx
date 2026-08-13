"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface LiveTab {
  id: string;
  status: string;
  checkDroppedAt: string | null;
  selectedTipCents: number | null;
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
  guestToken,
  onClose,
}: {
  tabId?: string;
  guestToken?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<LiveTab | null>(null);
  const [tipCents, setTipCents] = useState(0);
  const [customTipCents, setCustomTipCents] = useState("0");
  const [message, setMessage] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [tipError, setTipError] = useState("");
  const [tipPending, setTipPending] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const tipPendingRef = useRef(false);
  const paymentPendingRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const tabIdentityRef = useRef(0);
  const tipHydratedRef = useRef(false);
  const paymentAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  async function refresh() {
    if (refreshPendingRef.current || tipPendingRef.current || paymentPendingRef.current) return;
    refreshPendingRef.current = true;
    const requestId = ++refreshRequestRef.current;
    try {
      const nextTab = await apiFetch<LiveTab>(guestToken
        ? `/public/restaurant-tabs/${guestToken}`
        : `/customer/restaurant-tabs/${tabId}`
      );
      if (requestId !== refreshRequestRef.current) return;
      setTab(nextTab);
      if (!tipHydratedRef.current) {
        const persistedTipCents = nextTab.selectedTipCents ?? 0;
        setTipCents(persistedTipCents);
        setCustomTipCents(String(persistedTipCents));
        tipHydratedRef.current = true;
      }
      setRefreshError("");
    } catch (error) {
      if (requestId !== refreshRequestRef.current) return;
      setRefreshError(
        error instanceof ApiRequestError
          ? error.body.message
          : "Your live tab is unavailable.",
      );
    } finally {
      if (requestId === refreshRequestRef.current) refreshPendingRef.current = false;
    }
  }

  useEffect(() => {
    tabIdentityRef.current += 1;
    setTab(null);
    setTipCents(0);
    setCustomTipCents("0");
    setMessage("");
    setRefreshError("");
    setTipError("");
    tipHydratedRef.current = false;
    paymentAttemptRef.current = null;
    tipPendingRef.current = false;
    paymentPendingRef.current = false;
    setTipPending(false);
    setPaymentPending(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      tabIdentityRef.current += 1;
      refreshRequestRef.current += 1;
      refreshPendingRef.current = false;
      window.clearInterval(timer);
    };
  }, [tabId, guestToken]);

  async function chooseTip(value: number) {
    if (tipPendingRef.current || paymentPendingRef.current) return;
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
      setTipError("Enter a whole number from 0 to 1,000,000 cents.");
      return;
    }
    const tabIdentity = tabIdentityRef.current;
    tipPendingRef.current = true;
    refreshRequestRef.current += 1;
    refreshPendingRef.current = false;
    setTipPending(true);
    setTipError("");
    try {
      const updatedTab = await apiFetch<LiveTab>(
        guestToken
          ? `/public/restaurant-tabs/${guestToken}/tip`
          : `/customer/restaurant-tabs/${tabId}/tip`,
        {
        method: "POST",
        body: JSON.stringify({ tipCents: value }),
        },
      );
      if (tabIdentity !== tabIdentityRef.current) return;
      setTab(updatedTab);
      setTipCents(value);
      setCustomTipCents(String(value));
      setRefreshError("");
    } catch (error) {
      if (tabIdentity !== tabIdentityRef.current) return;
      setTipError(
        error instanceof ApiRequestError
          ? error.body.message
          : "Your tip could not be updated.",
      );
    } finally {
      if (tabIdentity === tabIdentityRef.current) {
        tipPendingRef.current = false;
        setTipPending(false);
      }
    }
  }

  async function pay() {
    if (paymentPendingRef.current || tipPendingRef.current) return;
    if (!tab?.activePaymentMethod) {
      return setMessage("Ask your server to collect a different card at the table.");
    }
    paymentPendingRef.current = true;
    const tabIdentity = tabIdentityRef.current;
    const paymentFingerprint = JSON.stringify({
      tabId: tab.id,
      tipCents,
      paymentMethodReferenceId: tab.activePaymentMethod.id,
    });
    if (paymentAttemptRef.current?.fingerprint !== paymentFingerprint) {
      paymentAttemptRef.current = {
        fingerprint: paymentFingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    refreshRequestRef.current += 1;
    refreshPendingRef.current = false;
    setPaymentPending(true);
    setMessage("");
    try {
      const result = await apiFetch<LiveTab>(
        guestToken
          ? `/public/restaurant-tabs/${guestToken}/pay`
          : `/customer/restaurant-tabs/${tabId}/pay`,
        {
          method: "POST",
          body: JSON.stringify({
            requestId: paymentAttemptRef.current.requestId,
            tipCents,
            paymentMethodReferenceId: tab.activePaymentMethod.id,
          }),
        },
      );
      if (tabIdentity !== tabIdentityRef.current) return;
      setTab(result);
      setRefreshError("");
      setMessage(
        result.status === "CLOSED"
          ? "Paid. Your receipt is ready."
          : "Payment needs attention. Your server has been notified.",
      );
      if (result.status !== "SETTLEMENT_PENDING") paymentAttemptRef.current = null;
    } catch (error) {
      if (tabIdentity !== tabIdentityRef.current) return;
      if (error instanceof ApiRequestError && error.status < 500) {
        paymentAttemptRef.current = null;
      }
      setMessage(
        error instanceof ApiRequestError
          ? error.body.message
          : "Payment could not be completed.",
      );
    } finally {
      if (tabIdentity === tabIdentityRef.current) {
        paymentPendingRef.current = false;
        setPaymentPending(false);
      }
    }
  }

  if (!tab) {
    return (
      <section className="account-panel">
        <button className="link" onClick={onClose}>Back</button>
        <p>{refreshError || "Loading your tab…"}</p>
      </section>
    );
  }
  const settlementProcessing = tab.status === "SETTLEMENT_PENDING";
  const customerPaymentAvailable = ["PREAUTHORIZED", "OPEN", "READY_TO_CLOSE", "PAYMENT_FAILED"].includes(tab.status);
  const controlsDisabled = tipPending || paymentPending;
  const balanceDueCents = Math.max(0, tab.totals.totalCents - tab.paidCents);
  const paymentFailed = tab.status === "PAYMENT_FAILED";
  const statusCopy = settlementProcessing
    ? "Your payment is processing. This page will update automatically."
    : tab.status === "CLOSED"
      ? "Your tab is paid and closed."
      : tab.status === "REFUNDED"
        ? "Your tab has been refunded."
        : tab.status === "VOIDED"
          ? "Your tab has been voided."
          : tab.status === "MANAGER_REVIEW"
            ? "Your payment needs attention. A manager has been notified."
            : paymentFailed
              ? "Your previous payment attempt was not completed. No automatic retry was made. Review the remaining balance and try again below."
            : tab.checkDroppedAt
              ? "Your check has been dropped. You can pay here or with your server."
              : "Your tab is still open.";
  return (
    <section className="account-panel">
      <button className="link" onClick={onClose}>Back to showtimes</button>
      <h2>Your live tab</h2>
      <p>{statusCopy}</p>
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
      {customerPaymentAvailable && <>
        <div>
          {[18, 20, 22].map((percent) => {
            const value = Math.round((tab.totals.subtotalCents * percent) / 100);
            return (
              <button
                className="secondary"
                key={percent}
                disabled={controlsDisabled}
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
            max="1000000"
            step="1"
            disabled={controlsDisabled}
            value={customTipCents}
            onChange={(event) => setCustomTipCents(event.target.value)}
          />
        </label>
        <button className="secondary" disabled={controlsDisabled} onClick={() => void chooseTip(Number(customTipCents))}>Update custom tip</button>
      </>}
      <h3>
        Balance due ${(balanceDueCents / 100).toFixed(2)}
      </h3>
      {customerPaymentAvailable && (
        <button className="primary" disabled={tipPending || paymentPending} onClick={pay}>{tipPending ? "Saving tip…" : paymentPending ? "Processing payment…" : paymentFailed ? "Retry remaining balance" : "Pay & close tab"}</button>
      )}
      {tab.receipt && <p>Receipt {tab.receipt.receiptNumber}</p>}
      {refreshError && <div className="error-banner">{refreshError}</div>}
      {tipError && <div className="error-banner">{tipError}</div>}
      {message && <div className="error-banner">{message}</div>}
    </section>
  );
}
