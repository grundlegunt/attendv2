"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

interface Menu {
  stations: Array<{ id: string; name: string; displayType: string }>;
  categories: Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string; priceCents: number; active: boolean; is86d: boolean; modifierGroups: Array<{ id: string; name: string; selectionType: "SINGLE" | "MULTIPLE"; required: boolean; modifiers: Array<{ id: string; name: string; priceDeltaCents: number; active: boolean }> }> }>;
  }>;
}

export function MenuManager({ accessToken }: { accessToken: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [stationId, setStationId] = useState("");
  const [message, setMessage] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [stationName, setStationName] = useState("");
  const [stationDisplayType, setStationDisplayType] = useState("KITCHEN");
  const [modifierItemId, setModifierItemId] = useState("");
  const [modifierGroupName, setModifierGroupName] = useState("");
  const [modifierSelectionType, setModifierSelectionType] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [modifierRequired, setModifierRequired] = useState(false);
  const [modifierGroupId, setModifierGroupId] = useState("");
  const [modifierName, setModifierName] = useState("");
  const [modifierPrice, setModifierPrice] = useState(0);

  const refresh = useCallback(() => {
    apiFetch<Menu>("/restaurant-menu/admin", { accessToken })
      .then((response) => {
        setMenu(response);
        setCategoryId((value) => value || response.categories[0]?.id || "");
        setStationId((value) => value || response.stations[0]?.id || "");
        setModifierItemId((value) => value || response.categories.flatMap((category) => category.items)[0]?.id || "");
        setModifierGroupId((value) => value || response.categories.flatMap((category) => category.items.flatMap((item) => item.modifierGroups))[0]?.id || "");
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

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    try { await apiFetch("/restaurant-menu/categories", { method: "POST", accessToken, body: JSON.stringify({ name: categoryName, sortOrder: menu?.categories.length ?? 0 }) }); setCategoryName(""); setMessage("Category created."); refresh(); } catch (error) { showError(error, "Category could not be created."); }
  }

  async function createStation(event: FormEvent) {
    event.preventDefault();
    try { await apiFetch("/restaurant-menu/stations", { method: "POST", accessToken, body: JSON.stringify({ name: stationName, displayType: stationDisplayType }) }); setStationName(""); setMessage("Kitchen station created."); refresh(); } catch (error) { showError(error, "Station could not be created."); }
  }

  async function createModifierGroup(event: FormEvent) {
    event.preventDefault();
    try { await apiFetch(`/restaurant-menu/items/${modifierItemId}/modifier-groups`, { method: "POST", accessToken, body: JSON.stringify({ name: modifierGroupName, selectionType: modifierSelectionType, required: modifierRequired, minSelections: modifierRequired ? 1 : 0, maxSelections: modifierSelectionType === "SINGLE" ? 1 : null, sortOrder: 0 }) }); setModifierGroupName(""); setModifierRequired(false); setMessage("Modifier group created."); refresh(); } catch (error) { showError(error, "Modifier group could not be created."); }
  }

  async function createModifier(event: FormEvent) {
    event.preventDefault();
    try { await apiFetch(`/restaurant-menu/modifier-groups/${modifierGroupId}/modifiers`, { method: "POST", accessToken, body: JSON.stringify({ name: modifierName, priceDeltaCents: Math.round(modifierPrice * 100), sortOrder: 0 }) }); setModifierName(""); setModifierPrice(0); setMessage("Modifier created."); refresh(); } catch (error) { showError(error, "Modifier could not be created."); }
  }

  function showError(error: unknown, fallback: string) {
    setMessage(error instanceof ApiRequestError ? error.body.message : fallback);
  }

  const items = menu?.categories.flatMap((category) => category.items) ?? [];
  const modifierGroups = items.flatMap((item) => item.modifierGroups.map((group) => ({ ...group, itemName: item.name })));

  return (
    <section className="management-stack">
      <section className="admin-grid">
        <form className="panel" onSubmit={createCategory}><p className="kicker">ORGANIZE</p><h2>Add category</h2><label>Name<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Concessions" /></label><button className="primary">Add category</button><ul>{menu?.categories.map((category) => <li key={category.id}>{category.name} · {category.items.length} items</li>)}</ul></form>
        <form className="panel" onSubmit={createStation}><p className="kicker">ROUTING</p><h2>Add kitchen station</h2><label>Name<input required value={stationName} onChange={(event) => setStationName(event.target.value)} placeholder="Hot line" /></label><label>Display type<input required value={stationDisplayType} onChange={(event) => setStationDisplayType(event.target.value)} /></label><button className="primary">Add station</button><ul>{menu?.stations.map((station) => <li key={station.id}>{station.name} · {station.displayType}</li>)}</ul></form>
      </section>
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
      <section className="admin-grid">
        <form className="panel" onSubmit={createModifierGroup}><p className="kicker">CUSTOMIZATION</p><h2>Add modifier group</h2><label>Menu item<select required value={modifierItemId} onChange={(event) => setModifierItemId(event.target.value)}><option value="">Select an item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Group name<input required value={modifierGroupName} onChange={(event) => setModifierGroupName(event.target.value)} placeholder="Choose a size" /></label><label>Selection type<select value={modifierSelectionType} onChange={(event) => setModifierSelectionType(event.target.value as "SINGLE" | "MULTIPLE")}><option value="SINGLE">Choose one</option><option value="MULTIPLE">Choose multiple</option></select></label><label className="checkbox"><input type="checkbox" checked={modifierRequired} onChange={(event) => setModifierRequired(event.target.checked)} /><span>Customer must choose</span></label><button className="primary">Add modifier group</button></form>
        <form className="panel" onSubmit={createModifier}><p className="kicker">OPTIONS</p><h2>Add modifier</h2><label>Modifier group<select required value={modifierGroupId} onChange={(event) => setModifierGroupId(event.target.value)}><option value="">Select a group</option>{modifierGroups.map((group) => <option key={group.id} value={group.id}>{group.itemName} · {group.name}</option>)}</select></label><label>Name<input required value={modifierName} onChange={(event) => setModifierName(event.target.value)} placeholder="Large" /></label><label>Price change<input type="number" step="0.01" value={modifierPrice} onChange={(event) => setModifierPrice(Number(event.target.value))} /></label><button className="primary">Add modifier</button><div className="modifier-summary">{modifierGroups.map((group) => <article key={group.id}><strong>{group.itemName} · {group.name}</strong><span>{group.selectionType === "SINGLE" ? "Choose one" : "Choose multiple"}{group.required ? " · Required" : " · Optional"}</span><small>{group.modifiers.map((modifier) => `${modifier.name}${modifier.priceDeltaCents ? ` (${modifier.priceDeltaCents > 0 ? "+" : ""}${(modifier.priceDeltaCents / 100).toFixed(2)})` : ""}`).join(", ") || "No options yet"}</small></article>)}</div></form>
      </section>
    </section>
  );
}
