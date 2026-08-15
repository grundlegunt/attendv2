import { OrderAheadQuoteError, quoteOrderAheadSelections } from "@cinema/ticketing";

const catalog = [
  {
    id: "burger",
    kitchenStationId: "kitchen",
    name: "Burger",
    priceCents: 1200,
    chargeCategory: "FOOD" as const,
    modifierGroups: [
      {
        id: "temperature",
        name: "Temperature",
        required: true,
        minSelections: 1,
        maxSelections: 1,
        modifiers: [
          { id: "medium", name: "Medium", priceDeltaCents: 0 },
          { id: "well", name: "Well done", priceDeltaCents: 0 },
        ],
      },
      {
        id: "extras",
        name: "Extras",
        required: false,
        minSelections: 0,
        maxSelections: 2,
        modifiers: [{ id: "cheese", name: "Cheese", priceDeltaCents: 150 }],
      },
    ],
  },
  {
    id: "soda",
    kitchenStationId: "bar",
    name: "Soda",
    priceCents: 500,
    chargeCategory: "NA_BEVERAGE" as const,
    modifierGroups: [],
  },
];

describe("quoteOrderAheadSelections", () => {
  it("creates a server-trusted snapshot and applies category pricing rules", () => {
    expect(
      quoteOrderAheadSelections({
        selections: [
          { menuItemId: "burger", quantity: 2, modifierIds: ["medium", "cheese"] },
          { menuItemId: "soda", quantity: 1, modifierIds: [] },
        ],
        catalog,
        taxRules: [
          { appliesTo: "FOOD", ratePermille: 100 },
          { appliesTo: "NA_BEVERAGE", ratePermille: 50 },
        ],
        serviceChargeRules: [{ appliesTo: "ALL", ratePermille: 20 }],
      }),
    ).toMatchObject({
      subtotalCents: 3200,
      taxCents: 295,
      serviceChargeCents: 64,
      totalCents: 3559,
      lines: [
        {
          menuItemId: "burger",
          quantity: 2,
          basePriceCents: 1200,
          unitPriceCents: 1350,
          totalCents: 2700,
        },
        { menuItemId: "soda", quantity: 1, totalCents: 500 },
      ],
    });
  });

  it("returns no tax or flat service charge for an empty basket", () => {
    expect(
      quoteOrderAheadSelections({
        selections: [],
        catalog,
        taxRules: [{ appliesTo: "ALL", ratePermille: 100 }],
        serviceChargeRules: [{ appliesTo: "ALL", flatCents: 200 }],
      }),
    ).toEqual({ lines: [], subtotalCents: 0, taxCents: 0, serviceChargeCents: 0, totalCents: 0 });
  });

  it.each([
    {
      name: "an unavailable item",
      selections: [{ menuItemId: "missing", quantity: 1, modifierIds: [] }],
    },
    {
      name: "an unavailable modifier",
      selections: [{ menuItemId: "burger", quantity: 1, modifierIds: ["medium", "bacon"] }],
    },
    {
      name: "a missing required modifier",
      selections: [{ menuItemId: "burger", quantity: 1, modifierIds: [] }],
    },
    {
      name: "multiple choices in a single-choice group",
      selections: [{ menuItemId: "burger", quantity: 1, modifierIds: ["medium", "well"] }],
    },
  ])("rejects $name", ({ selections }) => {
    expect(() =>
      quoteOrderAheadSelections({
        selections,
        catalog,
        taxRules: [],
        serviceChargeRules: [],
      }),
    ).toThrow(OrderAheadQuoteError);
  });
});
