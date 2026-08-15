export type OrderAheadChargeCategory = "FOOD" | "BEVERAGE" | "ALCOHOL";
export type OrderAheadRuleCategory = "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE";

export interface OrderAheadSelection {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
}

export interface OrderAheadCatalogItem {
  id: string;
  name: string;
  priceCents: number;
  chargeCategory: OrderAheadChargeCategory;
  modifierGroups: Array<{
    id: string;
    name: string;
    required: boolean;
    minSelections: number;
    maxSelections: number | null;
    modifiers: Array<{ id: string; name: string; priceDeltaCents: number }>;
  }>;
}

export interface OrderAheadPricingRule {
  appliesTo: OrderAheadRuleCategory;
  ratePermille?: number | null;
  flatCents?: number | null;
}

export interface OrderAheadQuote {
  lines: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    chargeCategory: OrderAheadChargeCategory;
    basePriceCents: number;
    modifiers: Array<{ id: string; name: string; priceDeltaCents: number }>;
    unitPriceCents: number;
    totalCents: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

export class OrderAheadQuoteError extends Error {}

function ruleBase(
  appliesTo: OrderAheadRuleCategory,
  subtotalCents: number,
  categoryTotals: Map<OrderAheadChargeCategory, number>,
) {
  if (appliesTo === "ALL") return subtotalCents;
  if (appliesTo === "NA_BEVERAGE") return categoryTotals.get("BEVERAGE") ?? 0;
  return categoryTotals.get(appliesTo) ?? 0;
}

export function quoteOrderAheadSelections(input: {
  selections: OrderAheadSelection[];
  catalog: OrderAheadCatalogItem[];
  taxRules: OrderAheadPricingRule[];
  serviceChargeRules: OrderAheadPricingRule[];
}): OrderAheadQuote {
  if (input.selections.length > 50) {
    throw new OrderAheadQuoteError("Order-ahead checkout supports at most 50 basket lines.");
  }

  const catalog = new Map(input.catalog.map((item) => [item.id, item]));
  const selectedItemIds = new Set<string>();
  const lines: OrderAheadQuote["lines"] = [];

  for (const selection of input.selections) {
    if (selectedItemIds.has(selection.menuItemId)) {
      throw new OrderAheadQuoteError("Each menu item may appear only once in an order-ahead basket.");
    }
    selectedItemIds.add(selection.menuItemId);
    if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 20) {
      throw new OrderAheadQuoteError("Menu item quantities must be whole numbers between 1 and 20.");
    }
    const item = catalog.get(selection.menuItemId);
    if (!item) throw new OrderAheadQuoteError("A selected menu item is unavailable.");

    const modifierIds = new Set(selection.modifierIds);
    if (modifierIds.size !== selection.modifierIds.length) {
      throw new OrderAheadQuoteError("A modifier may be selected only once per menu item.");
    }
    const knownModifierIds = new Set(
      item.modifierGroups.flatMap((group) => group.modifiers.map((modifier) => modifier.id)),
    );
    if (selection.modifierIds.some((id) => !knownModifierIds.has(id))) {
      throw new OrderAheadQuoteError("A selected modifier is unavailable for this menu item.");
    }

    for (const group of item.modifierGroups) {
      const selectionCount = group.modifiers.filter((modifier) => modifierIds.has(modifier.id)).length;
      const minimum = Math.max(group.required ? 1 : 0, group.minSelections);
      if (selectionCount < minimum) {
        throw new OrderAheadQuoteError(`${group.name} requires at least ${minimum} selection(s).`);
      }
      if (group.maxSelections != null && selectionCount > group.maxSelections) {
        throw new OrderAheadQuoteError(
          `${group.name} allows at most ${group.maxSelections} selection(s).`,
        );
      }
    }

    const modifiers = item.modifierGroups
      .flatMap((group) => group.modifiers)
      .filter((modifier) => modifierIds.has(modifier.id));
    const unitPriceCents =
      item.priceCents + modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0);
    if (unitPriceCents < 0) throw new OrderAheadQuoteError("Menu item pricing cannot be negative.");
    lines.push({
      menuItemId: item.id,
      name: item.name,
      quantity: selection.quantity,
      chargeCategory: item.chargeCategory,
      basePriceCents: item.priceCents,
      modifiers,
      unitPriceCents,
      totalCents: unitPriceCents * selection.quantity,
    });
  }

  const categoryTotals = new Map<OrderAheadChargeCategory, number>();
  for (const line of lines) {
    categoryTotals.set(
      line.chargeCategory,
      (categoryTotals.get(line.chargeCategory) ?? 0) + line.totalCents,
    );
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (subtotalCents === 0) {
    return { lines, subtotalCents: 0, taxCents: 0, serviceChargeCents: 0, totalCents: 0 };
  }
  const taxCents = input.taxRules.reduce(
    (sum, rule) =>
      sum + Math.round((ruleBase(rule.appliesTo, subtotalCents, categoryTotals) * (rule.ratePermille ?? 0)) / 1000),
    0,
  );
  const serviceChargeCents = input.serviceChargeRules.reduce(
    (sum, rule) =>
      sum +
      (rule.flatCents ??
        Math.round((ruleBase(rule.appliesTo, subtotalCents, categoryTotals) * (rule.ratePermille ?? 0)) / 1000)),
    0,
  );
  return {
    lines,
    subtotalCents,
    taxCents,
    serviceChargeCents,
    totalCents: subtotalCents + taxCents + serviceChargeCents,
  };
}
