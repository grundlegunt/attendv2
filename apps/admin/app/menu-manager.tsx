"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

interface Menu {
  stations: Array<{ id: string; name: string }>;
  categories: Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string; priceCents: number; active: boolean; is86d: boolean }>;
  }>;
}

export function MenuManager({ accessToken }: { accessToken: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [stationId, setStationId] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    apiFetch<Menu>("/restaurant-menu/admin", { accessToken })
      .then((response) => {
        setMenu(response);
        setCategoryId((value) => value || response.categories[0]?.id || "");
        setStationId((value) => value || response.stations[0]?.id || "");
      })
      .catch((error) =>
        setMessage(error instanceof ApiRequestError ? error.body.message : "Menu could not load."),
      );
  }, [accessToken]);

  useEffect(refresh, [refresh]);

  async function createItem(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/restaurant-menu/items", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          menuCategoryId: categoryId,
          kitchenStationId: stationId,
          name,
          priceCents: Math.round(price * 100),
          sortOrder: 0,
        }),
      });
      setName("");
      setPrice(0);
      setMessage("Menu item created.");
      refresh();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.body.message : "Item could not be created.");
    }
  }

  async function toggle86(item: Menu["categories"][number]["items"][number]) {
    await apiFetch(`/restaurant-menu/items/${item.id}`, {
      method: "PATCH",
      accessToken,
      body: JSON.stringify({ is86d: !item.is86d }),
    });
    refresh();
  }

  return (
    <section className="panel schedule">
      <p className="kicker">RESTAURANT</p>
      <h2>Menu management</h2>
      {message && <div className="error-banner">{message}</div>}
      <form onSubmit={createItem}>
        <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Price<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label>
        <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{menu?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Station<select value={stationId} onChange={(event) => setStationId(event.target.value)}>{menu?.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
        <button className="primary">Add menu item</button>
      </form>
      <div className="schedule-list">
        {menu?.categories.flatMap((category) => category.items.map((item) => (
          <article key={item.id}>
            <div><strong>{item.name}</strong><span>{category.name}</span></div>
            <div><strong>${(item.priceCents / 100).toFixed(2)}</strong><span>{item.active ? "Active" : "Inactive"}</span></div>
            <b className={item.is86d ? "sale-draft" : "sale-open"}>{item.is86d ? "86’D" : "AVAILABLE"}</b>
            <button className="secondary" type="button" onClick={() => toggle86(item)}>
              {item.is86d ? "Restore" : "86 item"}
            </button>
          </article>
        )))}
      </div>
    </section>
  );
}
