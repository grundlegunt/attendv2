"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

interface Menu {
  categories: Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      priceCents: number;
      is86d: boolean;
      kitchenStation: { name: string };
      modifierGroups: Array<{
        id: string;
        name: string;
        selectionType: "SINGLE" | "MULTIPLE";
        required: boolean;
        modifiers: Array<{ id: string; name: string }>;
      }>;
    }>;
  }>;
}

interface LiveTabSummary {
  orders: Array<{
    id: string;
    status: string;
    fulfillment: Array<{
      id: string;
      station: string;
      status: string;
      refireCount: number;
    }>;
  }>;
}

interface SettlementTab {
  status: string;
  checkDroppedAt: string | null;
  activePaymentMethod: { id: string; brand: string; last4: string } | null;
  totals: {
    subtotalCents: number;
    taxCents: number;
    serviceChargeCents: number;
    totalCents: number;
  };
  paidCents: number;
  receipt: { receiptNumber: string } | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function RestaurantPos({
  accessToken,
  initialTabId = "",
  showtimeSeatId,
  seatLabel,
}: {
  accessToken: string;
  initialTabId?: string;
  showtimeSeatId?: string;
  seatLabel?: string;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [tabId, setTabId] = useState(initialTabId);
  const [walkInLabel, setWalkInLabel] = useState("");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [modifierSelections, setModifierSelections] = useState<Record<string, string[]>>({});
  const [blockedItems, setBlockedItems] = useState<Array<{ id: string; name: string }>>([]);
  const [liveTab, setLiveTab] = useState<LiveTabSummary | null>(null);
  const [settlement, setSettlement] = useState<SettlementTab | null>(null);
  const [tipCents, setTipCents] = useState("0");
  const [savedCardCents, setSavedCardCents] = useState("");
  const [terminalCents, setTerminalCents] = useState("");
  const [readerId, setReaderId] = useState("tmr_test_reader");
  const [guestAccessToken, setGuestAccessToken] = useState("");
  const actionLocks = useRef(new Set<string>());
  const settlementAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const menuRequestRef = useRef(0);
  const menuPendingRef = useRef(false);
  const tabRefreshRequestRef = useRef(0);
  const tabRefreshPendingRef = useRef(false);
  const tabActionRequestRef = useRef(0);
  const [pendingActions, setPendingActions] = useState<string[]>([]);

  function beginAction(key: string) {
    if (actionLocks.current.has(key)) return false;
    actionLocks.current.add(key);
    setPendingActions([...actionLocks.current]);
    return true;
  }

  function finishAction(key: string) {
    actionLocks.current.delete(key);
    setPendingActions([...actionLocks.current]);
  }

  function isPending(key: string) {
    return pendingActions.includes(key);
  }

  function hasPendingSettlementAction(requestedTabId: string) {
    return actionLocks.current.has(`drop:${requestedTabId}`) ||
      actionLocks.current.has(`guest-link:${requestedTabId}`) ||
      actionLocks.current.has(`finalize:${requestedTabId}`);
  }

  function settlementBlocked() {
    if (orderId) {
      setMessage("Send or remove the current draft before changing the check.");
      return true;
    }
    return actionLocks.current.size > 0;
  }

  useEffect(() => {
    const refresh = () => {
      if (menuPendingRef.current) return Promise.resolve();
      menuPendingRef.current = true;
      const requestId = ++menuRequestRef.current;
      return (
      apiFetch<Menu>("/restaurant-menu", { accessToken })
        .then((nextMenu) => {
          if (requestId !== menuRequestRef.current) return;
          setMenu(nextMenu);
          setMenuError(null);
        })
        .catch(() => {
          if (requestId === menuRequestRef.current) {
            setMenuError("The restaurant menu is temporarily unavailable. Displayed availability may be out of date.");
          }
        })
        .finally(() => {
          if (requestId === menuRequestRef.current) menuPendingRef.current = false;
        })
      );
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      menuRequestRef.current += 1;
      menuPendingRef.current = false;
      window.clearInterval(timer);
    };
  }, [accessToken]);

  useEffect(() => setTabId(initialTabId), [initialTabId]);

  useEffect(() => {
    tabActionRequestRef.current += 1;
    settlementAttemptRef.current = null;
    setOrderId("");
    setBlockedItems([]);
    setModifierSelections({});
    setGuestAccessToken("");
    setTipCents("0");
    setSavedCardCents("");
    setTerminalCents("");
  }, [tabId]);

  useEffect(() => {
    tabRefreshRequestRef.current += 1;
    tabRefreshPendingRef.current = false;
    setLiveTab(null);
    setSettlement(null);
    setRefreshError(null);
    if (!UUID_PATTERN.test(tabId)) {
      return () => { tabRefreshRequestRef.current += 1; };
    }
    const refresh = () => {
      if (tabRefreshPendingRef.current) return Promise.resolve();
      tabRefreshPendingRef.current = true;
      const requestId = ++tabRefreshRequestRef.current;
      return (
      Promise.all([
        apiFetch<LiveTabSummary>(`/restaurant-tabs/${tabId}/summary`, { accessToken }),
        apiFetch<SettlementTab>(`/restaurant-settlement/tabs/${tabId}`, { accessToken }),
      ])
        .then(([summary, settlementTab]) => {
          if (requestId !== tabRefreshRequestRef.current) return;
          setLiveTab(summary);
          setSettlement(settlementTab);
          if (settlementTab.status === "CLOSED") {
            settlementAttemptRef.current = null;
            setGuestAccessToken("");
            setTipCents("0");
            setSavedCardCents("");
            setTerminalCents("");
          }
          setRefreshError(null);
        })
        .catch(() => {
          if (requestId === tabRefreshRequestRef.current) {
            setRefreshError("Live tab details are temporarily unavailable. Displayed information may be out of date.");
          }
        })
        .finally(() => {
          if (requestId === tabRefreshRequestRef.current) tabRefreshPendingRef.current = false;
        })
      );
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      tabRefreshRequestRef.current += 1;
      tabRefreshPendingRef.current = false;
      window.clearInterval(timer);
    };
  }, [accessToken, tabId]);

  function showError(error: unknown) {
    setMessage(error instanceof ApiRequestError ? error.body.message : "The request failed.");
  }

  async function openWalkIn(event: FormEvent) {
    event.preventDefault();
    if (orderId) {
      setMessage("Send or remove the current draft before opening another tab.");
      return;
    }
    if (actionLocks.current.size > 0) return;
    const requestedLabel = walkInLabel.trim();
    if (!requestedLabel) {
      setMessage("Enter a walk-in label.");
      return;
    }
    if (requestedLabel.length > 80) {
      setMessage("Walk-in labels cannot exceed 80 characters.");
      return;
    }
    const actionKey = "open-walk-in";
    if (!beginAction(actionKey)) return;
    const requestId = ++tabActionRequestRef.current;
    try {
      const tab = await apiFetch<{ id: string }>("/restaurant-tabs/walk-in", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ label: requestedLabel }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      setTabId(tab.id);
      setMessage(`Walk-in tab “${requestedLabel}” is open.`);
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function startOrder() {
    if (!UUID_PATTERN.test(tabId)) {
      setMessage("Enter a valid tab ID before starting an order.");
      return;
    }
    if (actionLocks.current.size > 0) return;
    const actionKey = `start-order:${tabId}`;
    if (!tabId || !beginAction(actionKey)) return;
    const requestId = ++tabActionRequestRef.current;
    const requestedTabId = tabId;
    try {
      const order = await apiFetch<{ id: string }>(`/restaurant-tabs/${requestedTabId}/orders`, {
        method: "POST",
        accessToken,
        body: JSON.stringify(showtimeSeatId ? { showtimeSeatId } : {}),
      });
      if (requestId !== tabActionRequestRef.current) return;
      setOrderId(order.id);
      setBlockedItems([]);
      setModifierSelections({});
      setMessage("Order started. Add items, then send.");
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function addItem(item: Menu["categories"][number]["items"][number]) {
    if (!orderId) return setMessage("Start an order first.");
    if (actionLocks.current.size > 0) return;
    const missingRequiredGroup = item.modifierGroups.find(
      (group) => group.required && !(modifierSelections[`${item.id}:${group.id}`]?.length),
    );
    if (missingRequiredGroup) {
      setMessage(`Choose an option for ${missingRequiredGroup.name} before adding ${item.name}.`);
      return;
    }
    const actionKey = `add-item:${orderId}:${item.id}`;
    if (!beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedOrderId = orderId;
    try {
      const modifierIds = item.modifierGroups.flatMap(
        (group) => modifierSelections[`${item.id}:${group.id}`] ?? [],
      );
      await apiFetch(`/restaurant-tabs/orders/${requestedOrderId}/items`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({ menuItemId: item.id, quantity: 1, modifierIds }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      setMessage(`${item.name} added.`);
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function removeBlockedItem(item: { id: string; name: string }) {
    const actionKey = `remove-item:${orderId}:${item.id}`;
    if (!orderId || actionLocks.current.size > 0 || !beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedOrderId = orderId;
    try {
      await apiFetch(`/restaurant-tabs/orders/${requestedOrderId}/items/${item.id}`, {
        method: "DELETE",
        accessToken,
      });
      if (requestId !== tabActionRequestRef.current) return;
      setBlockedItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`${item.name} removed. Add a substitute or send the remaining draft.`);
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  function chooseModifier(
    itemId: string,
    group: Menu["categories"][number]["items"][number]["modifierGroups"][number],
    modifierId: string,
    selected: boolean,
  ) {
    const key = `${itemId}:${group.id}`;
    setModifierSelections((current) => ({
      ...current,
      [key]:
        group.selectionType === "SINGLE"
          ? [modifierId]
          : selected
            ? [...new Set([...(current[key] ?? []), modifierId])]
            : (current[key] ?? []).filter((id) => id !== modifierId),
    }));
  }

  async function sendOrder() {
    const actionKey = `send:${orderId}`;
    if (!orderId || actionLocks.current.size > 0 || !beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedOrderId = orderId;
    try {
      const result = await apiFetch<{
        rejectedDraft: null | {
          orderId: string;
          items: Array<{ id: string; name: string; reason: string }>;
        };
      }>(`/restaurant-tabs/orders/${requestedOrderId}/send`, {
        method: "POST",
        accessToken,
        body: "{}",
      });
      if (requestId !== tabActionRequestRef.current) return;
      setOrderId(result.rejectedDraft?.orderId ?? "");
      setBlockedItems(result.rejectedDraft?.items ?? []);
      setMessage(
        result.rejectedDraft
          ? `Available items sent. Replace or remove: ${result.rejectedDraft.items
              .map((item) => item.name)
              .join(", ")}.`
          : "Order sent to its stations.",
      );
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function refire(ticketId: string) {
    if (actionLocks.current.size > 0) return;
    const actionKey = `refire:${ticketId}`;
    if (!beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    try {
      await apiFetch(`/restaurant-tabs/fulfillment/${ticketId}/refire`, {
        method: "POST",
        accessToken,
        body: "{}",
      });
      if (requestId !== tabActionRequestRef.current) return;
      setMessage("Refire sent to the station.");
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function dropCheck() {
    if (settlementBlocked()) return;
    const actionKey = `drop:${tabId}`;
    if (!tabId || hasPendingSettlementAction(tabId) || !beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedTabId = tabId;
    try {
      await apiFetch(`/restaurant-settlement/tabs/${requestedTabId}/drop-check`, {
        method: "POST",
        accessToken,
        body: "{}",
      });
      if (requestId !== tabActionRequestRef.current) return;
      setMessage("Check dropped. One final order may still be added before payment.");
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function finalizeTab() {
    if (!settlement) return;
    if (settlementBlocked()) return;
    const parsedTipCents = Number(tipCents || 0);
    const parsedSavedCardCents = Number(savedCardCents || 0);
    const parsedTerminalCents = Number(terminalCents || 0);
    if (
      !Number.isInteger(parsedTipCents) ||
      !Number.isInteger(parsedSavedCardCents) ||
      !Number.isInteger(parsedTerminalCents) ||
      parsedTipCents < 0 ||
      parsedSavedCardCents < 0 ||
      parsedTerminalCents < 0
    ) {
      setMessage("Tip and tender amounts must be whole, non-negative cents.");
      return;
    }
    if (parsedTipCents > 1_000_000) {
      setMessage("Tip cannot exceed 1,000,000 cents.");
      return;
    }
    if (parsedSavedCardCents > 10_000_000 || parsedTerminalCents > 10_000_000) {
      setMessage("A single tender cannot exceed 10,000,000 cents.");
      return;
    }
    if (parsedSavedCardCents > 0 && !settlement.activePaymentMethod) {
      setMessage("The saved payment method is no longer available.");
      return;
    }
    const balanceCents =
      settlement.totals.subtotalCents +
      settlement.totals.taxCents +
      settlement.totals.serviceChargeCents +
      parsedTipCents -
      settlement.paidCents;
    const tenderedCents = parsedSavedCardCents + parsedTerminalCents;
    if (balanceCents <= 0) {
      setMessage("This tab has no remaining balance to collect.");
      return;
    }
    if (tenderedCents !== balanceCents) {
      setMessage(`Tender amounts must total the remaining balance of ${balanceCents} cents.`);
      return;
    }
    if (parsedTerminalCents > 0 && !readerId.trim()) {
      setMessage("Choose a Terminal reader for the presented card payment.");
      return;
    }
    if (parsedTerminalCents > 0 && readerId.trim().length > 200) {
      setMessage("Terminal reader IDs cannot exceed 200 characters.");
      return;
    }
    const actionKey = `finalize:${tabId}`;
    if (!tabId || hasPendingSettlementAction(tabId) || !beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedTabId = tabId;
    const tenders = [
      ...(parsedSavedCardCents > 0 && settlement.activePaymentMethod
        ? [{
            type: "SAVED_METHOD",
            amountCents: parsedSavedCardCents,
            paymentMethodReferenceId: settlement.activePaymentMethod.id,
          }]
        : []),
      ...(parsedTerminalCents > 0
        ? [{
            type: "CARD_PRESENT",
            amountCents: parsedTerminalCents,
            readerId: readerId.trim(),
          }]
        : []),
    ];
    const settlementPayload = { tipCents: parsedTipCents, tenders };
    const fingerprint = JSON.stringify(settlementPayload);
    if (settlementAttemptRef.current?.fingerprint !== fingerprint) {
      settlementAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const result = await apiFetch<{ status: string }>(
        `/restaurant-settlement/tabs/${requestedTabId}/finalize`,
        {
          method: "POST",
          accessToken,
          body: JSON.stringify({
            ...settlementPayload,
            requestId: settlementAttemptRef.current.requestId,
          }),
        },
      );
      if (requestId !== tabActionRequestRef.current) return;
      if (result.status === "CLOSED") {
        settlementAttemptRef.current = null;
        setGuestAccessToken("");
      }
      setMessage(
        result.status === "CLOSED"
          ? "Tab paid and closed. Receipt issued."
          : `Settlement needs attention: ${result.status}.`,
      );
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function createGuestLink() {
    if (settlementBlocked()) return;
    const actionKey = `guest-link:${tabId}`;
    if (!tabId || hasPendingSettlementAction(tabId) || !beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedTabId = tabId;
    try {
      const result = await apiFetch<{ token: string }>(
        `/restaurant-settlement/tabs/${requestedTabId}/access-link`,
        { method: "POST", accessToken, body: "{}" },
      );
      if (requestId !== tabActionRequestRef.current) return;
      setGuestAccessToken(result.token);
      setMessage("Secure 24-hour guest tab link created.");
    } catch (error) {
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  const settlementPending = isPending(`finalize:${tabId}`);
  const restaurantActionPending = pendingActions.length > 0;
  const checkActionBlocked = Boolean(orderId) || pendingActions.length > 0;

  return (
    <section className="scanner-panel">
      <h2>Server POS</h2>
      {seatLabel && <p><strong>Seat {seatLabel}</strong></p>}
      <p>Open a walk-in tab, or paste an existing seat-linked tab ID.</p>
      {menuError && <div className="error-banner">{menuError}</div>}
      {refreshError && <div className="error-banner">{refreshError}</div>}
      <form onSubmit={openWalkIn}>
        <label className="field">
          <span>Walk-in label</span>
          <input
            required
            maxLength={80}
            placeholder="Guest name or bar number"
            value={walkInLabel}
            disabled={Boolean(orderId) || pendingActions.length > 0}
            onChange={(event) => setWalkInLabel(event.target.value)}
          />
        </label>
        <button className="primary" disabled={Boolean(orderId) || pendingActions.length > 0}>
          {isPending("open-walk-in") ? "Opening walk-in…" : "Open walk-in tab"}
        </button>
      </form>
      <label className="field">
        <span>Active tab ID</span>
        <input
          value={tabId}
          maxLength={36}
          disabled={Boolean(orderId) || pendingActions.length > 0}
          onChange={(event) => setTabId(event.target.value)}
        />
      </label>
      {orderId && <p>Send or remove the current draft before switching tabs.</p>}
      <button
        className="primary"
        type="button"
        disabled={!UUID_PATTERN.test(tabId) || Boolean(orderId) || pendingActions.length > 0}
        onClick={startOrder}
      >
        {isPending(`start-order:${tabId}`)
          ? "Starting order…"
          : orderId
            ? "Order in progress"
            : "Start order"}
      </button>
      {message && <div className="scan-result valid"><strong>{message}</strong></div>}
      {settlement && (
        <div className="scan-result">
          <h3>Check · {settlement.status}</h3>
          <p>
            Subtotal ${(settlement.totals.subtotalCents / 100).toFixed(2)} · Tax $
            {(settlement.totals.taxCents / 100).toFixed(2)} · Service $
            {(settlement.totals.serviceChargeCents / 100).toFixed(2)}
          </p>
          <strong>
            Due ${((settlement.totals.totalCents - settlement.paidCents) / 100).toFixed(2)}
          </strong>
          {!settlement.checkDroppedAt && settlement.status !== "CLOSED" && (
            <button
              className="secondary"
              type="button"
              disabled={checkActionBlocked}
              onClick={dropCheck}
            >
              {isPending(`drop:${tabId}`) ? "Dropping check…" : "Drop check"}
            </button>
          )}
          {settlement.status !== "CLOSED" && settlement.activePaymentMethod && (
            <button
              className="secondary"
              type="button"
              disabled={checkActionBlocked}
              onClick={createGuestLink}
            >
              {isPending(`guest-link:${tabId}`) ? "Creating guest link…" : "Create guest tab link"}
            </button>
          )}
          {guestAccessToken && (
            <p>
              Guest link token: <code>{guestAccessToken}</code>
            </p>
          )}
          {settlement.checkDroppedAt && settlement.status !== "CLOSED" && (
            <>
              <label className="field">
                <span>Tip (cents)</span>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  value={tipCents}
                  disabled={checkActionBlocked}
                  onChange={(event) => setTipCents(event.target.value)}
                />
              </label>
              {settlement.activePaymentMethod && (
                <label className="field">
                  <span>
                    {settlement.activePaymentMethod.brand} ····
                    {settlement.activePaymentMethod.last4} amount (cents)
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="1"
                    value={savedCardCents}
                    disabled={checkActionBlocked}
                    onChange={(event) => setSavedCardCents(event.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>Presented card amount (cents)</span>
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="1"
                  value={terminalCents}
                  disabled={checkActionBlocked}
                  onChange={(event) => setTerminalCents(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Terminal reader</span>
                <input value={readerId} maxLength={200} disabled={checkActionBlocked || Number(terminalCents) <= 0} onChange={(event) => setReaderId(event.target.value)} />
              </label>
              <button
                className="primary"
                type="button"
                disabled={checkActionBlocked}
                onClick={finalizeTab}
              >
                {settlementPending ? "Collecting payment…" : "Collect payment & close"}
              </button>
            </>
          )}
          {settlement.receipt && <p>Receipt {settlement.receipt.receiptNumber}</p>}
        </div>
      )}
      {liveTab?.orders.flatMap((order) =>
        order.fulfillment.map((ticket) => (
          <div
            className={`scan-result ${ticket.status === "READY" ? "valid" : ""}`}
            key={ticket.id}
          >
            <strong>{ticket.station}: {ticket.status}</strong>
            <p>Order {order.status}{ticket.refireCount ? ` · refire ${ticket.refireCount}` : ""}</p>
            {ticket.status === "DELIVERED" && (
              <button
                className="secondary"
                type="button"
                disabled={pendingActions.length > 0}
                onClick={() => refire(ticket.id)}
              >
                {isPending(`refire:${ticket.id}`) ? "Refiring…" : "Refire"}
              </button>
            )}
          </div>
        )),
      )}
      {blockedItems.map((item) => (
        <div className="scan-result" key={item.id}>
          <strong>{item.name} is unavailable</strong>
          <button
            className="secondary"
            type="button"
            disabled={restaurantActionPending}
            onClick={() => removeBlockedItem(item)}
          >
            {isPending(`remove-item:${orderId}:${item.id}`) ? "Removing…" : "Remove from draft"}
          </button>
        </div>
      ))}
      {menu?.categories.map((category) => (
        <div key={category.id}>
          <h3>{category.name}</h3>
          {category.items.map((item) => (
            <div className="scan-result" key={item.id}>
              <strong>
                {item.name} · ${(item.priceCents / 100).toFixed(2)}
              </strong>
              <p>{item.description} · routes to {item.kitchenStation.name}</p>
              {item.modifierGroups.map((group) => (
                <fieldset key={group.id}>
                  <legend>{group.name}{group.required ? " · required" : ""}</legend>
                  {group.modifiers.map((modifier) => {
                    const selected = (modifierSelections[`${item.id}:${group.id}`] ?? [])
                      .includes(modifier.id);
                    return (
                      <label key={modifier.id}>
                        <input
                          type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                          name={`${item.id}:${group.id}`}
                          checked={selected}
                          disabled={restaurantActionPending}
                          onChange={(event) =>
                            chooseModifier(item.id, group, modifier.id, event.target.checked)
                          }
                        />
                        {modifier.name}
                      </label>
                    );
                  })}
                </fieldset>
              ))}
              <button
                className="secondary"
                type="button"
                disabled={item.is86d || !orderId || restaurantActionPending}
                onClick={() => addItem(item)}
              >
                {isPending(`add-item:${orderId}:${item.id}`)
                  ? "Adding…"
                  : item.is86d
                    ? "86’d"
                    : "Add item"}
              </button>
            </div>
          ))}
        </div>
      ))}
      <button
        className="primary"
        type="button"
        disabled={!orderId || restaurantActionPending}
        onClick={sendOrder}
      >
        {isPending(`send:${orderId}`) ? "Sending order…" : "Send order"}
      </button>
    </section>
  );
}
