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
const DEFAULT_READER_ID = "tmr_test_reader";

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
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<Array<{
    menuItemId: string;
    name: string;
    priceCents: number;
  }>>([]);
  const [blockedItems, setBlockedItems] = useState<Array<{ id: string; name: string }>>([]);
  const [liveTab, setLiveTab] = useState<LiveTabSummary | null>(null);
  const [settlement, setSettlement] = useState<SettlementTab | null>(null);
  const [tipCents, setTipCents] = useState("0");
  const [savedCardCents, setSavedCardCents] = useState("");
  const [terminalCents, setTerminalCents] = useState("");
  const [readerId, setReaderId] = useState(DEFAULT_READER_ID);
  const [guestAccessToken, setGuestAccessToken] = useState("");
  const actionLocks = useRef(new Set<string>());
  const settlementAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const addItemAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const startOrderAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const walkInAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const refireAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const removeItemAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const sendOrderAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
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

  function changeActiveTabId(nextTabId: string) {
    tabRefreshRequestRef.current += 1;
    tabRefreshPendingRef.current = false;
    setLiveTab(null);
    setSettlement(null);
    setRefreshError(null);
    setTabId(nextTabId);
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
          setActiveCategoryId((current) =>
            nextMenu.categories.some((category) => category.id === current)
              ? current
              : (nextMenu.categories[0]?.id ?? ""),
          );
          const validSelections = new Map<string, Set<string>>();
          nextMenu.categories.forEach((category) => category.items.forEach((item) =>
            item.modifierGroups.forEach((group) => validSelections.set(
              `${item.id}:${group.id}`,
              new Set(group.modifiers.map((modifier) => modifier.id)),
            )),
          ));
          setModifierSelections((current) => Object.fromEntries(
            Object.entries(current)
              .map(([key, ids]) => [key, ids.filter((id) => validSelections.get(key)?.has(id))] as const)
              .filter(([, ids]) => ids.length),
          ));
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
    setDraftItems([]);
    setExpandedItemId(null);
    setBlockedItems([]);
    setModifierSelections({});
    setGuestAccessToken("");
    setMessage("");
    setTipCents("0");
    setSavedCardCents("");
    setTerminalCents("");
    setReaderId(DEFAULT_READER_ID);
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
            setReaderId(DEFAULT_READER_ID);
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
    const fingerprint = JSON.stringify({ label: requestedLabel });
    if (walkInAttemptRef.current?.fingerprint !== fingerprint) {
      walkInAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const tab = await apiFetch<{ id: string }>("/restaurant-tabs/walk-in", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          requestId: walkInAttemptRef.current.requestId,
          label: requestedLabel,
        }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      walkInAttemptRef.current = null;
      changeActiveTabId(tab.id);
      setWalkInLabel("");
      setMessage(`Walk-in tab “${requestedLabel}” is open.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        walkInAttemptRef.current = null;
      }
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
    const fingerprint = JSON.stringify({
      tabId: requestedTabId,
      showtimeSeatId: showtimeSeatId ?? null,
    });
    if (startOrderAttemptRef.current?.fingerprint !== fingerprint) {
      startOrderAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const order = await apiFetch<{ id: string }>(`/restaurant-tabs/${requestedTabId}/orders`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          requestId: startOrderAttemptRef.current.requestId,
          ...(showtimeSeatId ? { showtimeSeatId } : {}),
        }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      startOrderAttemptRef.current = null;
      setOrderId(order.id);
      setDraftItems([]);
      setBlockedItems([]);
      setModifierSelections({});
      setMessage("Order started. Add items, then send.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        startOrderAttemptRef.current = null;
      }
      if (requestId === tabActionRequestRef.current) showError(error);
    } finally {
      finishAction(actionKey);
    }
  }

  async function addItem(item: Menu["categories"][number]["items"][number]) {
    if (!orderId) return setMessage("Start an order first.");
    if (actionLocks.current.size > 0) return;
    if (item.is86d) {
      setMessage(`${item.name} is unavailable. Choose another item.`);
      return;
    }
    const selectedModifiers = item.modifierGroups.map((group) => {
      const availableIds = new Set(group.modifiers.map((modifier) => modifier.id));
      return {
        group,
        ids: (modifierSelections[`${item.id}:${group.id}`] ?? [])
          .filter((modifierId) => availableIds.has(modifierId)),
      };
    });
    const missingRequiredGroup = selectedModifiers.find(({ group, ids }) => group.required && !ids.length)?.group;
    if (missingRequiredGroup) {
      setMessage(`Choose an option for ${missingRequiredGroup.name} before adding ${item.name}.`);
      return;
    }
    const actionKey = `add-item:${orderId}:${item.id}`;
    if (!beginAction(actionKey)) return;
    const requestId = tabActionRequestRef.current;
    const requestedOrderId = orderId;
    const modifierIds = selectedModifiers.flatMap(({ ids }) => ids);
    const fingerprint = JSON.stringify({
      orderId: requestedOrderId,
      menuItemId: item.id,
      modifierIds: [...modifierIds].sort(),
    });
    if (addItemAttemptRef.current?.fingerprint !== fingerprint) {
      addItemAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/restaurant-tabs/orders/${requestedOrderId}/items`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          requestId: addItemAttemptRef.current.requestId,
          menuItemId: item.id,
          quantity: 1,
          modifierIds,
        }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      addItemAttemptRef.current = null;
      setModifierSelections((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${item.id}:`)),
      ));
      setDraftItems((current) => [
        ...current,
        { menuItemId: item.id, name: item.name, priceCents: item.priceCents },
      ]);
      setExpandedItemId(null);
      setMessage(`${item.name} added.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        addItemAttemptRef.current = null;
      }
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
    const fingerprint = JSON.stringify({ orderId: requestedOrderId, orderItemId: item.id });
    if (removeItemAttemptRef.current?.fingerprint !== fingerprint) {
      removeItemAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      await apiFetch(`/restaurant-tabs/orders/${requestedOrderId}/items/${item.id}`, {
        method: "DELETE",
        accessToken,
        body: JSON.stringify({ requestId: removeItemAttemptRef.current.requestId }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      removeItemAttemptRef.current = null;
      setBlockedItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`${item.name} removed. Add a substitute or send the remaining draft.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        removeItemAttemptRef.current = null;
      }
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
    const fingerprint = JSON.stringify({ orderId: requestedOrderId });
    if (sendOrderAttemptRef.current?.fingerprint !== fingerprint) {
      sendOrderAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const result = await apiFetch<{
        rejectedDraft: null | {
          orderId: string;
          items: Array<{ id: string; name: string; reason: string }>;
        };
      }>(`/restaurant-tabs/orders/${requestedOrderId}/send`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({ requestId: sendOrderAttemptRef.current.requestId }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      sendOrderAttemptRef.current = null;
      setOrderId(result.rejectedDraft?.orderId ?? "");
      setDraftItems([]);
      setBlockedItems(result.rejectedDraft?.items ?? []);
      setMessage(
        result.rejectedDraft
          ? `Available items sent. Replace or remove: ${result.rejectedDraft.items
              .map((item) => item.name)
              .join(", ")}.`
          : "Order sent to its stations.",
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        sendOrderAttemptRef.current = null;
      }
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
    const fingerprint = JSON.stringify({ ticketId });
    if (refireAttemptRef.current?.fingerprint !== fingerprint) {
      refireAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/restaurant-tabs/fulfillment/${ticketId}/refire`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({ requestId: refireAttemptRef.current.requestId }),
      });
      if (requestId !== tabActionRequestRef.current) return;
      refireAttemptRef.current = null;
      setMessage("Refire sent to the station.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status < 500) {
        refireAttemptRef.current = null;
      }
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
  const activeCategory =
    menu?.categories.find((category) => category.id === activeCategoryId) ??
    menu?.categories[0] ??
    null;
  const draftSubtotalCents = draftItems.reduce((total, item) => total + item.priceCents, 0);

  return (
    <section className="scanner-panel restaurant-pos">
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
          onChange={(event) => changeActiveTabId(event.target.value)}
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
      <div className="restaurant-workspace">
        <div className="restaurant-menu-browser">
          <div className="restaurant-menu-heading">
            <div>
              <span className="eyebrow">Menu</span>
              <h3>{activeCategory?.name ?? "No menu available"}</h3>
            </div>
            <span>{activeCategory?.items.length ?? 0} items</span>
          </div>
          <div className="restaurant-item-grid">
            {activeCategory?.items.map((item) => {
              const expanded = expandedItemId === item.id;
              return (
                <article
                  className={`restaurant-item-tile${expanded ? " expanded" : ""}${item.is86d ? " unavailable" : ""}`}
                  key={item.id}
                >
                  <button
                    className="restaurant-item-trigger"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`restaurant-item-${item.id}`}
                    onClick={() => setExpandedItemId(expanded ? null : item.id)}
                  >
                    <strong>{item.name}</strong>
                    <span>${(item.priceCents / 100).toFixed(2)}</span>
                    {item.is86d && <small>86’d</small>}
                  </button>
                  {expanded && (
                    <div className="restaurant-item-options" id={`restaurant-item-${item.id}`}>
                      {item.description && <p>{item.description}</p>}
                      <small>Routes to {item.kitchenStation.name}</small>
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
                  )}
                </article>
              );
            })}
          </div>
          <div className="restaurant-category-tabs" role="tablist" aria-label="Menu categories">
            {menu?.categories.map((category) => (
              <button
                type="button"
                role="tab"
                aria-selected={category.id === activeCategory?.id}
                className={category.id === activeCategory?.id ? "active" : ""}
                key={category.id}
                onClick={() => {
                  setActiveCategoryId(category.id);
                  setExpandedItemId(null);
                }}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
        <aside className="restaurant-check-sidebar" aria-label="Current check">
          <span className="eyebrow">Current check</span>
          <h3>{orderId ? "Draft order" : "Start an order"}</h3>
          {seatLabel && <p>Seat {seatLabel}</p>}
          {draftItems.length ? (
            <ul className="restaurant-draft-items">
              {draftItems.map((item, index) => (
                <li key={`${item.menuItemId}-${index}`}>
                  <span>{item.name}</span>
                  <strong>${(item.priceCents / 100).toFixed(2)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>No items added yet.</p>
          )}
          <div className="restaurant-draft-total">
            <span>Draft subtotal</span>
            <strong>${(draftSubtotalCents / 100).toFixed(2)}</strong>
          </div>
          <button
            className="primary"
            type="button"
            disabled={!orderId || restaurantActionPending}
            onClick={sendOrder}
          >
            {isPending(`send:${orderId}`) ? "Sending order…" : "Send order"}
          </button>
        </aside>
      </div>
    </section>
  );
}
