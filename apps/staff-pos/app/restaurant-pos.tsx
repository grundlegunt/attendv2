"use client";

import { FormEvent, useEffect, useState } from "react";
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
  const [modifierSelections, setModifierSelections] = useState<Record<string, string[]>>({});
  const [blockedItems, setBlockedItems] = useState<Array<{ id: string; name: string }>>([]);
  const [liveTab, setLiveTab] = useState<LiveTabSummary | null>(null);

  useEffect(() => {
    const refresh = () =>
      apiFetch<Menu>("/restaurant-menu", { accessToken })
        .then(setMenu)
        .catch(() => setMessage("The restaurant menu is unavailable."));
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [accessToken]);

  useEffect(() => setTabId(initialTabId), [initialTabId]);

  useEffect(() => {
    if (!tabId) {
      setLiveTab(null);
      return;
    }
    const refresh = () =>
      apiFetch<LiveTabSummary>(`/restaurant-tabs/${tabId}/summary`, { accessToken })
        .then(setLiveTab)
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [accessToken, tabId]);

  function showError(error: unknown) {
    setMessage(error instanceof ApiRequestError ? error.body.message : "The request failed.");
  }

  async function openWalkIn(event: FormEvent) {
    event.preventDefault();
    try {
      const tab = await apiFetch<{ id: string }>("/restaurant-tabs/walk-in", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ label: walkInLabel }),
      });
      setTabId(tab.id);
      setMessage(`Walk-in tab “${walkInLabel}” is open.`);
    } catch (error) {
      showError(error);
    }
  }

  async function startOrder() {
    try {
      const order = await apiFetch<{ id: string }>(`/restaurant-tabs/${tabId}/orders`, {
        method: "POST",
        accessToken,
        body: JSON.stringify(showtimeSeatId ? { showtimeSeatId } : {}),
      });
      setOrderId(order.id);
      setMessage("Order started. Add items, then send.");
    } catch (error) {
      showError(error);
    }
  }

  async function addItem(item: Menu["categories"][number]["items"][number]) {
    if (!orderId) return setMessage("Start an order first.");
    try {
      const modifierIds = item.modifierGroups.flatMap(
        (group) => modifierSelections[`${item.id}:${group.id}`] ?? [],
      );
      await apiFetch(`/restaurant-tabs/orders/${orderId}/items`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({ menuItemId: item.id, quantity: 1, modifierIds }),
      });
      setMessage(`${item.name} added.`);
    } catch (error) {
      showError(error);
    }
  }

  async function removeBlockedItem(item: { id: string; name: string }) {
    try {
      await apiFetch(`/restaurant-tabs/orders/${orderId}/items/${item.id}`, {
        method: "DELETE",
        accessToken,
      });
      setBlockedItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`${item.name} removed. Add a substitute or send the remaining draft.`);
    } catch (error) {
      showError(error);
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
    try {
      const result = await apiFetch<{
        rejectedDraft: null | {
          orderId: string;
          items: Array<{ id: string; name: string; reason: string }>;
        };
      }>(`/restaurant-tabs/orders/${orderId}/send`, {
        method: "POST",
        accessToken,
        body: "{}",
      });
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
      showError(error);
    }
  }

  async function refire(ticketId: string) {
    try {
      await apiFetch(`/restaurant-tabs/fulfillment/${ticketId}/refire`, {
        method: "POST",
        accessToken,
        body: "{}",
      });
      setMessage("Refire sent to the station.");
    } catch (error) {
      showError(error);
    }
  }

  return (
    <section className="scanner-panel">
      <h2>Server POS</h2>
      {seatLabel && <p><strong>Seat {seatLabel}</strong></p>}
      <p>Open a walk-in tab, or paste an existing seat-linked tab ID.</p>
      <form onSubmit={openWalkIn}>
        <label className="field">
          <span>Walk-in label</span>
          <input
            required
            placeholder="Guest name or bar number"
            value={walkInLabel}
            onChange={(event) => setWalkInLabel(event.target.value)}
          />
        </label>
        <button className="primary">Open walk-in tab</button>
      </form>
      <label className="field">
        <span>Active tab ID</span>
        <input value={tabId} onChange={(event) => setTabId(event.target.value)} />
      </label>
      <button className="primary" type="button" disabled={!tabId || Boolean(orderId)} onClick={startOrder}>
        {orderId ? "Order in progress" : "Start order"}
      </button>
      {message && <div className="scan-result valid"><strong>{message}</strong></div>}
      {liveTab?.orders.flatMap((order) =>
        order.fulfillment.map((ticket) => (
          <div
            className={`scan-result ${ticket.status === "READY" ? "valid" : ""}`}
            key={ticket.id}
          >
            <strong>{ticket.station}: {ticket.status}</strong>
            <p>Order {order.status}{ticket.refireCount ? ` · refire ${ticket.refireCount}` : ""}</p>
            {ticket.status === "DELIVERED" && (
              <button className="secondary" type="button" onClick={() => refire(ticket.id)}>
                Refire
              </button>
            )}
          </div>
        )),
      )}
      {blockedItems.map((item) => (
        <div className="scan-result" key={item.id}>
          <strong>{item.name} is unavailable</strong>
          <button className="secondary" type="button" onClick={() => removeBlockedItem(item)}>
            Remove from draft
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
                disabled={item.is86d || !orderId}
                onClick={() => addItem(item)}
              >
                {item.is86d ? "86’d" : "Add item"}
              </button>
            </div>
          ))}
        </div>
      ))}
      <button className="primary" type="button" disabled={!orderId} onClick={sendOrder}>
        Send order
      </button>
    </section>
  );
}
