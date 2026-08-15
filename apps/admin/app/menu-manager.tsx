"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { CUSTOMER_WEB_URL } from "./lib/customer-site";

interface Menu {
  stations: Array<{ id: string; name: string; displayType: string; active: boolean }>;
  categories: Array<{
    id: string;
    name: string;
    sortOrder: number;
    active: boolean;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      imageUrl: string | null;
      priceCents: number;
      chargeCategory: "FOOD" | "ALCOHOL" | "NA_BEVERAGE";
      isVegan: boolean;
      isGlutenFree: boolean;
      sortOrder: number;
      active: boolean;
      is86d: boolean;
      kitchenStation: { id: string; name: string };
      modifierGroups: Array<{
        id: string;
        name: string;
        selectionType: "SINGLE" | "MULTIPLE";
        required: boolean;
        minSelections: number;
        maxSelections: number | null;
        active: boolean;
        sortOrder: number;
        modifiers: Array<{
          id: string;
          name: string;
          priceDeltaCents: number;
          active: boolean;
        }>;
      }>;
    }>;
  }>;
}

type MenuItem = Menu["categories"][number]["items"][number];

export function MenuManager({ accessToken }: { accessToken: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [price, setPrice] = useState(0);
  const [chargeCategory, setChargeCategory] = useState<"FOOD" | "ALCOHOL" | "NA_BEVERAGE">("FOOD");
  const [isVegan, setIsVegan] = useState(false);
  const [isGlutenFree, setIsGlutenFree] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [stationId, setStationId] = useState("");
  const [message, setMessage] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategorySortOrder, setEditingCategorySortOrder] = useState(0);
  const [stationName, setStationName] = useState("");
  const [stationDisplayType, setStationDisplayType] = useState("KITCHEN");
  const [editingStationId, setEditingStationId] = useState("");
  const [editingStationName, setEditingStationName] = useState("");
  const [editingStationDisplayType, setEditingStationDisplayType] = useState("");
  const [modifierItemId, setModifierItemId] = useState("");
  const [modifierGroupName, setModifierGroupName] = useState("");
  const [modifierSelectionType, setModifierSelectionType] = useState<
    "SINGLE" | "MULTIPLE"
  >("SINGLE");
  const [modifierRequired, setModifierRequired] = useState(false);
  const [modifierMinSelections, setModifierMinSelections] = useState(0);
  const [modifierMaxSelections, setModifierMaxSelections] = useState<
    number | ""
  >(1);
  const [modifierGroupId, setModifierGroupId] = useState("");
  const [editingModifierGroupId, setEditingModifierGroupId] = useState("");
  const [editingModifierGroupName, setEditingModifierGroupName] = useState("");
  const [editingModifierGroupSelectionType, setEditingModifierGroupSelectionType] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [editingModifierGroupRequired, setEditingModifierGroupRequired] = useState(false);
  const [editingModifierGroupMin, setEditingModifierGroupMin] = useState(0);
  const [editingModifierGroupMax, setEditingModifierGroupMax] = useState<number | "">(1);
  const [editingModifierGroupOrder, setEditingModifierGroupOrder] = useState(0);
  const [modifierName, setModifierName] = useState("");
  const [modifierPrice, setModifierPrice] = useState(0);
  const [editingModifierId, setEditingModifierId] = useState("");
  const [editingModifierName, setEditingModifierName] = useState("");
  const [editingModifierPrice, setEditingModifierPrice] = useState(0);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editPrice, setEditPrice] = useState(0);
  const [editChargeCategory, setEditChargeCategory] = useState<"FOOD" | "ALCOHOL" | "NA_BEVERAGE">("FOOD");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [originalEditCategoryId, setOriginalEditCategoryId] = useState("");
  const [editStationId, setEditStationId] = useState("");
  const [originalEditStationId, setOriginalEditStationId] = useState("");
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [editActive, setEditActive] = useState(true);
  const [editIsVegan, setEditIsVegan] = useState(false);
  const [editIsGlutenFree, setEditIsGlutenFree] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [itemCategoryFilter, setItemCategoryFilter] = useState("");
  const [itemAvailabilityFilter, setItemAvailabilityFilter] = useState("");
  const refreshSequence = useRef(0);
  const lastLoadedMenu = useRef<Menu | null>(null);
  const emptyResponseRetries = useRef(0);

  const refresh = useCallback(() => {
    const requestSequence = ++refreshSequence.current;
    apiFetch<Menu>("/restaurant-menu/admin", { accessToken })
      .then((response) => {
        if (requestSequence !== refreshSequence.current) return;
        const responseItemCount = response.categories.reduce(
          (count, category) => count + category.items.length,
          0,
        );
        const previousItemCount = lastLoadedMenu.current?.categories.reduce(
          (count, category) => count + category.items.length,
          0,
        ) ?? 0;
        if (previousItemCount > 0 && responseItemCount === 0) {
          emptyResponseRetries.current += 1;
          setMessage("Menu data temporarily returned empty. Keeping the last loaded menu and retrying.");
          window.setTimeout(refresh, Math.min(1_000 * emptyResponseRetries.current, 5_000));
          return;
        }
        emptyResponseRetries.current = 0;
        lastLoadedMenu.current = response;
        setMenu(response);
        setCategoryId((value) =>
          response.categories.some((category) => category.id === value && category.active)
            ? value
            : response.categories.find((category) => category.active)?.id || "",
        );
        setStationId((value) =>
          response.stations.some((station) => station.id === value && station.active)
            ? value
            : response.stations.find((station) => station.active)?.id || "",
        );
        setModifierItemId(
          (value) =>
            value ||
            response.categories.flatMap((category) => category.items)[0]?.id ||
            "",
        );
      setModifierGroupId(
          (value) =>
            value ||
            response.categories.flatMap((category) =>
              category.items.flatMap((item) => item.modifierGroups),
            )[0]?.id ||
            "",
        );
      })
      .catch((error) => {
        if (requestSequence !== refreshSequence.current) return;
        setMessage(
          error instanceof ApiRequestError
            ? error.body.message
            : "Menu could not load.",
        );
      });
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
          description: description || undefined,
          imageUrl: imageUrl || undefined,
          priceCents: Math.round(price * 100),
          chargeCategory,
          isVegan,
          isGlutenFree,
          sortOrder:
            menu?.categories.find((category) => category.id === categoryId)
              ?.items.length ?? 0,
        }),
      });
      setImageUrl("");
      setName("");
      setDescription("");
      setPrice(0);
      setChargeCategory("FOOD");
      setIsVegan(false);
      setIsGlutenFree(false);
      setMessage("Menu item created.");
      refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiRequestError
          ? error.body.message
          : "Item could not be created.",
      );
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
    try {
      await apiFetch("/restaurant-menu/categories", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          name: categoryName,
          sortOrder: menu?.categories.length ?? 0,
        }),
      });
      setCategoryName("");
      setMessage("Category created.");
      refresh();
    } catch (error) {
      showError(error, "Category could not be created.");
    }
  }

  async function updateCategory(
    category: Menu["categories"][number],
    changes: { name?: string; sortOrder?: number; active?: boolean },
  ) {
    try {
      await apiFetch(`/restaurant-menu/categories/${category.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(changes),
      });
      setEditingCategoryId("");
      setMessage("Category updated.");
      refresh();
    } catch (error) {
      showError(error, "Category could not be updated.");
    }
  }

  async function createStation(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/restaurant-menu/stations", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          name: stationName,
          displayType: stationDisplayType,
        }),
      });
      setStationName("");
      setMessage("Kitchen station created.");
      refresh();
    } catch (error) {
      showError(error, "Station could not be created.");
    }
  }

  async function updateStation(
    station: Menu["stations"][number],
    changes: { name?: string; displayType?: string; active?: boolean },
  ) {
    try {
      await apiFetch(`/restaurant-menu/stations/${station.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(changes),
      });
      setEditingStationId("");
      setMessage("Kitchen station updated.");
      refresh();
    } catch (error) {
      showError(error, "Station could not be updated.");
    }
  }

  async function createModifierGroup(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(
        `/restaurant-menu/items/${modifierItemId}/modifier-groups`,
        {
          method: "POST",
          accessToken,
          body: JSON.stringify({
            name: modifierGroupName,
            selectionType: modifierSelectionType,
            required: modifierRequired,
            minSelections: modifierMinSelections,
            maxSelections:
              modifierMaxSelections === "" ? null : modifierMaxSelections,
            sortOrder: modifierGroups.filter(
              (group) => group.menuItemId === modifierItemId,
            ).length,
          }),
        },
      );
      setModifierGroupName("");
      setModifierRequired(false);
      setModifierMinSelections(0);
      setModifierMaxSelections(1);
      setMessage("Modifier group created.");
      refresh();
    } catch (error) {
      showError(error, "Modifier group could not be created.");
    }
  }

  async function createModifier(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(
        `/restaurant-menu/modifier-groups/${modifierGroupId}/modifiers`,
        {
          method: "POST",
          accessToken,
          body: JSON.stringify({
            name: modifierName,
            priceDeltaCents: Math.round(modifierPrice * 100),
            sortOrder: 0,
          }),
        },
      );
      setModifierName("");
      setModifierPrice(0);
      setMessage("Modifier created.");
      refresh();
    } catch (error) {
      showError(error, "Modifier could not be created.");
    }
  }

  async function saveModifierGroup(group: (typeof modifierGroups)[number]) {
    try {
      await apiFetch(`/restaurant-menu/modifier-groups/${group.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({
          name: editingModifierGroupName,
          selectionType: editingModifierGroupSelectionType,
          required: editingModifierGroupRequired,
          minSelections: editingModifierGroupMin,
          maxSelections: editingModifierGroupMax === "" ? null : editingModifierGroupMax,
          sortOrder: editingModifierGroupOrder,
        }),
      });
      setEditingModifierGroupId("");
      setMessage("Modifier group updated.");
      refresh();
    } catch (error) {
      showError(error, "Modifier group could not be updated.");
    }
  }

  async function toggleModifierGroup(group: (typeof modifierGroups)[number]) {
    try {
      await apiFetch(`/restaurant-menu/modifier-groups/${group.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({ active: !group.active }),
      });
      setMessage(group.active ? "Modifier group retired." : "Modifier group restored.");
      refresh();
    } catch (error) {
      showError(error, "Modifier group could not be updated.");
    }
  }

  function beginEditingModifierGroup(group: (typeof modifierGroups)[number]) {
    setEditingModifierGroupId(group.id);
    setEditingModifierGroupName(group.name);
    setEditingModifierGroupSelectionType(group.selectionType);
    setEditingModifierGroupRequired(group.required);
    setEditingModifierGroupMin(group.minSelections);
    setEditingModifierGroupMax(group.maxSelections ?? "");
    setEditingModifierGroupOrder(group.sortOrder);
  }

  async function updateModifier(
    modifier: MenuItem["modifierGroups"][number]["modifiers"][number],
    changes: { name?: string; priceDeltaCents?: number; active?: boolean },
  ) {
    try {
      await apiFetch(`/restaurant-menu/modifiers/${modifier.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(changes),
      });
      setEditingModifierId("");
      setMessage("Modifier updated.");
      refresh();
    } catch (error) {
      showError(error, "Modifier could not be updated.");
    }
  }

  function showError(error: unknown, fallback: string) {
    setMessage(
      error instanceof ApiRequestError ? error.body.message : fallback,
    );
  }

  function beginEditing(item: MenuItem, currentCategoryId: string) {
    setEditingItem(item);
    setEditName(item.name);
    setEditDescription(item.description ?? "");
    setEditImageUrl(item.imageUrl ?? "");
    setEditPrice(item.priceCents / 100);
    setEditChargeCategory(item.chargeCategory);
    setEditCategoryId(currentCategoryId);
    setOriginalEditCategoryId(currentCategoryId);
    setEditStationId(item.kitchenStation.id);
    setOriginalEditStationId(item.kitchenStation.id);
    setEditSortOrder(item.sortOrder);
    setEditActive(item.active);
    setEditIsVegan(item.isVegan);
    setEditIsGlutenFree(item.isGlutenFree);
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!editingItem) return;
    try {
      await apiFetch(`/restaurant-menu/items/${editingItem.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          imageUrl: editImageUrl || null,
          priceCents: Math.round(editPrice * 100),
          chargeCategory: editChargeCategory,
          ...(editCategoryId !== originalEditCategoryId
            ? { menuCategoryId: editCategoryId }
            : {}),
          ...(editStationId !== originalEditStationId
            ? { kitchenStationId: editStationId }
            : {}),
          sortOrder: editSortOrder,
          active: editActive,
          isVegan: editIsVegan,
          isGlutenFree: editIsGlutenFree,
        }),
      });
      setEditingItem(null);
      setMessage("Menu item updated.");
      refresh();
    } catch (error) {
      showError(error, "Menu item could not be updated.");
    }
  }

  const items = menu?.categories.flatMap((category) => category.items) ?? [];
  const modifierGroups = items.flatMap((item) =>
    item.modifierGroups.map((group) => ({
      ...group,
      itemName: item.name,
      menuItemId: item.id,
    })),
  );
  const normalizedItemQuery = itemQuery.trim().toLowerCase();
  const filteredItems =
    menu?.categories.flatMap((category) =>
      category.items
        .filter((item) => {
          const matchesQuery =
            !normalizedItemQuery ||
            [item.name, item.description, category.name, item.kitchenStation.name]
              .filter(Boolean)
              .some((value) => value!.toLowerCase().includes(normalizedItemQuery));
          const matchesCategory =
            !itemCategoryFilter || category.id === itemCategoryFilter;
          const matchesAvailability =
            !itemAvailabilityFilter ||
            (itemAvailabilityFilter === "ACTIVE" && item.active && !item.is86d) ||
            (itemAvailabilityFilter === "86D" && item.is86d) ||
            (itemAvailabilityFilter === "INACTIVE" && !item.active);
          return matchesQuery && matchesCategory && matchesAvailability;
        })
        .map((item) => ({ item, category })),
    ) ?? [];

  return (
    <section className="management-stack">
      <section className="admin-grid">
        <form className="panel" onSubmit={createCategory}>
          <p className="kicker">ORGANIZE</p>
          <h2>Add category</h2>
          <label>
            Name
            <input
              required
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Concessions"
            />
          </label>
          <button className="primary">Add category</button>
          <div className="category-admin-list">
            {menu?.categories.map((category) => (
              <article key={category.id}>
                {editingCategoryId === category.id ? (
                  <>
                    <label>
                      Category name
                      <input
                        required
                        value={editingCategoryName}
                        onChange={(event) => setEditingCategoryName(event.target.value)}
                      />
                    </label>
                    <label>
                      Display order
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editingCategorySortOrder}
                        onChange={(event) => setEditingCategorySortOrder(Number(event.target.value))}
                      />
                    </label>
                    <div className="rule-actions">
                      <button className="secondary" type="button" onClick={() => void updateCategory(category, { name: editingCategoryName, sortOrder: editingCategorySortOrder })}>Save</button>
                      <button className="secondary" type="button" onClick={() => setEditingCategoryId("")}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <strong>{category.name}</strong>
                      <span>{category.items.length} items · order {category.sortOrder} · {category.active ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="rule-actions">
                      <button className="secondary" type="button" onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); setEditingCategorySortOrder(category.sortOrder); }}>Edit</button>
                      <button className="secondary" type="button" onClick={() => void updateCategory(category, { active: !category.active })}>{category.active ? "Deactivate" : "Restore"}</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </form>
        <form className="panel" onSubmit={createStation}>
          <p className="kicker">ROUTING</p>
          <h2>Add kitchen station</h2>
          <label>
            Name
            <input
              required
              value={stationName}
              onChange={(event) => setStationName(event.target.value)}
              placeholder="Hot line"
            />
          </label>
          <label>
            Display type
            <input
              required
              value={stationDisplayType}
              onChange={(event) => setStationDisplayType(event.target.value)}
            />
          </label>
          <button className="primary">Add station</button>
          <div className="category-admin-list">
            {menu?.stations.map((station) => (
              <article key={station.id}>
                {editingStationId === station.id ? (
                  <>
                    <label>
                      Station name
                      <input required value={editingStationName} onChange={(event) => setEditingStationName(event.target.value)} />
                    </label>
                    <label>
                      Display type
                      <input required value={editingStationDisplayType} onChange={(event) => setEditingStationDisplayType(event.target.value)} />
                    </label>
                    <div className="rule-actions">
                      <button className="secondary" type="button" onClick={() => void updateStation(station, { name: editingStationName, displayType: editingStationDisplayType })}>Save</button>
                      <button className="secondary" type="button" onClick={() => setEditingStationId("")}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <strong>{station.name}</strong>
                      <span>{station.displayType} · {station.active ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="rule-actions">
                      <button className="secondary" type="button" onClick={() => { setEditingStationId(station.id); setEditingStationName(station.name); setEditingStationDisplayType(station.displayType); }}>Edit</button>
                      <button className="secondary" type="button" onClick={() => void updateStation(station, { active: !station.active })}>{station.active ? "Retire" : "Restore"}</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </form>
      </section>
      <section className="panel schedule">
        <div className="management-heading">
          <div><p className="kicker">RESTAURANT</p><h2>Menu management</h2></div>
          <a className="secondary button-link" href={`${CUSTOMER_WEB_URL}/dining-bar`} target="_blank" rel="noreferrer">Preview customer Dining page</a>
        </div>
        <p>
          Create items, route them to a kitchen station, and keep pricing and
          availability current.
        </p>
        {message && <div className="error-banner">{message}</div>}
        <form onSubmit={createItem}>
          <label>
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional details shown to staff and guests"
            />
          </label>
          <label>
            Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(Number(event.target.value))}
            />
          </label>
          <label>
            Tax and charge category
            <select
              value={chargeCategory}
              onChange={(event) => setChargeCategory(event.target.value as "FOOD" | "ALCOHOL" | "NA_BEVERAGE")}
            >
              <option value="FOOD">Food</option>
              <option value="ALCOHOL">Alcohol</option>
              <option value="NA_BEVERAGE">Non-alcoholic beverage</option>
            </select>
          </label>
          <label>
            Image URL
            <input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" />
          </label>
          {imageUrl && <div className="menu-image-preview"><img src={imageUrl} alt="" /><span>Customer menu preview</span></div>}
          <div className="two-fields">
            <label className="checkbox">
              <input type="checkbox" checked={isVegan} onChange={(event) => setIsVegan(event.target.checked)} />
              <span>Vegan</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={isGlutenFree} onChange={(event) => setIsGlutenFree(event.target.checked)} />
              <span>Gluten-free</span>
            </label>
          </div>
          <label>
            Category
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {menu?.categories.filter((category) => category.active).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Station
            <select
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
            >
              {menu?.stations.filter((station) => station.active).map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!categoryId || !stationId}>Add menu item</button>
          {menu && (!categoryId || !stationId) && (
            <p className="builder-help">Create or restore an active category and kitchen station before adding menu items.</p>
          )}
        </form>
        <div className="filter-grid menu-item-filters">
          <label>
            Search menu items
            <input
              type="search"
              value={itemQuery}
              onChange={(event) => setItemQuery(event.target.value)}
              placeholder="Name, description, category, or station"
            />
          </label>
          <label>
            Category
            <select
              value={itemCategoryFilter}
              onChange={(event) => setItemCategoryFilter(event.target.value)}
            >
              <option value="">All categories</option>
              {menu?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Availability
            <select
              value={itemAvailabilityFilter}
              onChange={(event) => setItemAvailabilityFilter(event.target.value)}
            >
              <option value="">All items</option>
              <option value="ACTIVE">Active and available</option>
              <option value="86D">86’d</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>
        <p className="menu-item-filter-count">
          Showing {filteredItems.length} of {items.length} menu items
        </p>
        <div className="schedule-list">
          {filteredItems.map(({ item, category }) => (
              <article key={item.id}>
                <div className="menu-item-summary">
                  {item.imageUrl && <img src={item.imageUrl} alt="" />}
                  <span>
                    <strong>{item.name}</strong>
                    <small>{category.name}{item.description ? ` · ${item.description}` : ""}</small>
                  </span>
                </div>
                <div>
                  <strong>${(item.priceCents / 100).toFixed(2)}</strong>
                  <span>
                    {item.kitchenStation.name} ·{" "}
                    {item.active ? "Active" : "Inactive"} · {item.chargeCategory === "NA_BEVERAGE" ? "Non-alcoholic beverage" : item.chargeCategory === "ALCOHOL" ? "Alcohol" : "Food"}
                  </span>
                </div>
                <b className={item.is86d ? "sale-draft" : "sale-open"}>
                  {item.is86d ? "86’D" : "AVAILABLE"}
                </b>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => beginEditing(item, category.id)}
                >
                  Edit
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => toggle86(item)}
                >
                  {item.is86d ? "Restore" : "86 item"}
                </button>
              </article>
          ))}
          {menu && filteredItems.length === 0 && (
            <p>No menu items match these filters.</p>
          )}
        </div>
        {editingItem && (
          <form className="menu-item-editor" onSubmit={saveItem}>
            <div className="management-heading">
              <div>
                <p className="kicker">EDIT ITEM</p>
                <h3>{editingItem.name}</h3>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() => setEditingItem(null)}
              >
                Cancel
              </button>
            </div>
            <div className="two-fields">
              <label>
                Name
                <input
                  required
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
              </label>
              <label>
                Price
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={editPrice}
                  onChange={(event) => setEditPrice(Number(event.target.value))}
                />
              </label>
              <label>
                Tax and charge category
                <select
                  value={editChargeCategory}
                  onChange={(event) => setEditChargeCategory(event.target.value as "FOOD" | "ALCOHOL" | "NA_BEVERAGE")}
                >
                  <option value="FOOD">Food</option>
                  <option value="ALCOHOL">Alcohol</option>
                  <option value="NA_BEVERAGE">Non-alcoholic beverage</option>
                </select>
              </label>
            </div>
            <label>
              Description
              <textarea
                rows={3}
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>
            <label>
              Image URL
              <input type="url" value={editImageUrl} onChange={(event) => setEditImageUrl(event.target.value)} placeholder="https://…" />
            </label>
            {editImageUrl && <div className="menu-image-preview"><img src={editImageUrl} alt="" /><span>Customer menu preview</span></div>}
            <div className="two-fields">
              <label>
                Category
                <select
                  required
                  value={editCategoryId}
                  onChange={(event) => setEditCategoryId(event.target.value)}
                >
                  {menu?.categories.map((category) => (
                    <option
                      key={category.id}
                      value={category.id}
                      disabled={!category.active && category.id !== originalEditCategoryId}
                    >
                      {category.name}{category.active ? "" : " (Inactive)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kitchen station
                <select
                  required
                  value={editStationId}
                  onChange={(event) => setEditStationId(event.target.value)}
                >
                  {menu?.stations.map((station) => (
                    <option
                      key={station.id}
                      value={station.id}
                      disabled={!station.active && station.id !== originalEditStationId}
                    >
                      {station.name}{station.active ? "" : " (Inactive)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Display order
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editSortOrder}
                  onChange={(event) =>
                    setEditSortOrder(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(event) => setEditActive(event.target.checked)}
              />
              <span>Active and visible on the menu</span>
            </label>
            <div className="two-fields">
              <label className="checkbox">
                <input type="checkbox" checked={editIsVegan} onChange={(event) => setEditIsVegan(event.target.checked)} />
                <span>Vegan</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={editIsGlutenFree} onChange={(event) => setEditIsGlutenFree(event.target.checked)} />
                <span>Gluten-free</span>
              </label>
            </div>
            <button className="primary">Save item</button>
          </form>
        )}
      </section>
      <section className="admin-grid">
        <form className="panel" onSubmit={createModifierGroup}>
          <p className="kicker">CUSTOMIZATION</p>
          <h2>Add modifier group</h2>
          <label>
            Menu item
            <select
              required
              value={modifierItemId}
              onChange={(event) => setModifierItemId(event.target.value)}
            >
              <option value="">Select an item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Group name
            <input
              required
              value={modifierGroupName}
              onChange={(event) => setModifierGroupName(event.target.value)}
              placeholder="Choose a size"
            />
          </label>
          <label>
            Selection type
            <select
              value={modifierSelectionType}
              onChange={(event) => {
                const type = event.target.value as "SINGLE" | "MULTIPLE";
                setModifierSelectionType(type);
                setModifierMaxSelections(type === "SINGLE" ? 1 : "");
                if (type === "SINGLE" && modifierMinSelections > 1)
                  setModifierMinSelections(1);
              }}
            >
              <option value="SINGLE">Choose one</option>
              <option value="MULTIPLE">Choose multiple</option>
            </select>
          </label>
          <div className="two-fields">
            <label>
              Minimum choices
              <input
                type="number"
                min="0"
                max={modifierSelectionType === "SINGLE" ? 1 : undefined}
                step="1"
                value={modifierMinSelections}
                onChange={(event) =>
                  setModifierMinSelections(Number(event.target.value))
                }
              />
            </label>
            <label>
              Maximum choices
              <input
                type="number"
                min="1"
                step="1"
                placeholder="No limit"
                value={modifierMaxSelections}
                disabled={modifierSelectionType === "SINGLE"}
                onChange={(event) =>
                  setModifierMaxSelections(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={modifierRequired}
              onChange={(event) => {
                setModifierRequired(event.target.checked);
                if (event.target.checked && modifierMinSelections === 0)
                  setModifierMinSelections(1);
              }}
            />
            <span>Customer must choose</span>
          </label>
          <button className="primary">Add modifier group</button>
        </form>
        <form className="panel" onSubmit={createModifier}>
          <p className="kicker">OPTIONS</p>
          <h2>Add modifier</h2>
          <label>
            Modifier group
            <select
              required
              value={modifierGroupId}
              onChange={(event) => setModifierGroupId(event.target.value)}
            >
              <option value="">Select a group</option>
              {modifierGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.itemName} · {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              required
              value={modifierName}
              onChange={(event) => setModifierName(event.target.value)}
              placeholder="Large"
            />
          </label>
          <label>
            Price change
            <input
              type="number"
              step="0.01"
              value={modifierPrice}
              onChange={(event) => setModifierPrice(Number(event.target.value))}
            />
          </label>
          <button className="primary">Add modifier</button>
          <div className="modifier-summary">
            {modifierGroups.map((group) => (
              <article key={group.id}>
                {editingModifierGroupId === group.id ? (
                  <div className="modifier-group-editor">
                    <label>Name<input required value={editingModifierGroupName} onChange={(event) => setEditingModifierGroupName(event.target.value)} /></label>
                    <label>Selection type<select value={editingModifierGroupSelectionType} onChange={(event) => { const value = event.target.value as "SINGLE" | "MULTIPLE"; setEditingModifierGroupSelectionType(value); if (value === "SINGLE") { setEditingModifierGroupMin(Math.min(editingModifierGroupMin, 1)); setEditingModifierGroupMax(1); } }}><option value="SINGLE">Choose one</option><option value="MULTIPLE">Choose multiple</option></select></label>
                    <label>Minimum<input type="number" min="0" max={editingModifierGroupSelectionType === "SINGLE" ? 1 : undefined} value={editingModifierGroupMin} onChange={(event) => setEditingModifierGroupMin(Number(event.target.value))} /></label>
                    <label>Maximum<input type="number" min="1" max={editingModifierGroupSelectionType === "SINGLE" ? 1 : undefined} disabled={editingModifierGroupSelectionType === "SINGLE"} placeholder="No limit" value={editingModifierGroupMax} onChange={(event) => setEditingModifierGroupMax(event.target.value === "" ? "" : Number(event.target.value))} /></label>
                    <label>Display order<input type="number" min="0" step="1" value={editingModifierGroupOrder} onChange={(event) => setEditingModifierGroupOrder(Number(event.target.value))} /></label>
                    <label className="checkbox"><input type="checkbox" checked={editingModifierGroupRequired} onChange={(event) => { setEditingModifierGroupRequired(event.target.checked); if (event.target.checked && editingModifierGroupMin === 0) setEditingModifierGroupMin(1); }} /><span>Customer must choose</span></label>
                    <div className="rule-actions"><button className="secondary" type="button" onClick={() => void saveModifierGroup(group)}>Save group</button><button className="secondary" type="button" onClick={() => setEditingModifierGroupId("")}>Cancel</button></div>
                  </div>
                ) : (
                  <>
                    <strong>{group.itemName} · {group.name}</strong>
                    <span>{group.selectionType === "SINGLE" ? "Choose one" : "Choose multiple"} · {group.minSelections} minimum · {group.maxSelections ?? "No"} maximum{group.required ? " · Required" : " · Optional"} · order {group.sortOrder}{group.active ? "" : " · Inactive"}</span>
                    <div className="rule-actions"><button className="secondary" type="button" onClick={() => beginEditingModifierGroup(group)}>Edit group</button><button className="secondary" type="button" onClick={() => void toggleModifierGroup(group)}>{group.active ? "Retire group" : "Restore group"}</button></div>
                  </>
                )}
                <div className="modifier-option-list">
                  {group.modifiers.map((modifier) => (
                    <div key={modifier.id}>
                      {editingModifierId === modifier.id ? (
                        <>
                          <input aria-label="Modifier name" required value={editingModifierName} onChange={(event) => setEditingModifierName(event.target.value)} />
                          <input aria-label="Modifier price change" type="number" step="0.01" value={editingModifierPrice} onChange={(event) => setEditingModifierPrice(Number(event.target.value))} />
                          <button className="secondary" type="button" onClick={() => void updateModifier(modifier, { name: editingModifierName, priceDeltaCents: Math.round(editingModifierPrice * 100) })}>Save</button>
                          <button className="secondary" type="button" onClick={() => setEditingModifierId("")}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span>{modifier.name}{modifier.priceDeltaCents ? ` (${modifier.priceDeltaCents > 0 ? "+" : ""}${(modifier.priceDeltaCents / 100).toFixed(2)})` : ""}{modifier.active ? "" : " · Inactive"}</span>
                          <button className="secondary" type="button" onClick={() => { setEditingModifierId(modifier.id); setEditingModifierName(modifier.name); setEditingModifierPrice(modifier.priceDeltaCents / 100); }}>Edit</button>
                          <button className="secondary" type="button" onClick={() => void updateModifier(modifier, { active: !modifier.active })}>{modifier.active ? "Deactivate" : "Restore"}</button>
                        </>
                      )}
                    </div>
                  ))}
                  {group.modifiers.length === 0 && <small>No options yet</small>}
                </div>
              </article>
            ))}
          </div>
        </form>
      </section>
    </section>
  );
}
