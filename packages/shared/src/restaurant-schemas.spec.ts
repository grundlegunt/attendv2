import {
  createMenuItemRequestSchema,
  updateKitchenStationRequestSchema,
  updateMenuCategoryRequestSchema,
  updateMenuItemRequestSchema,
  updateModifierRequestSchema,
  updateModifierGroupRequestSchema,
} from "./restaurant-schemas";

describe("menu item dietary attributes", () => {
  it("defaults new menu items to no dietary claims", () => {
    const parsed = createMenuItemRequestSchema.parse({
      menuCategoryId: "10000000-0000-4000-8000-000000000001",
      kitchenStationId: "10000000-0000-4000-8000-000000000002",
      name: "Popcorn",
      priceCents: 900,
    });
    expect(parsed).toEqual(expect.objectContaining({ isVegan: false, isGlutenFree: false }));
  });

  it("accepts explicit dietary updates", () => {
    expect(updateMenuItemRequestSchema.parse({ isVegan: true, isGlutenFree: true }))
      .toEqual({ isVegan: true, isGlutenFree: true });
  });
});

describe("menu category updates", () => {
  it("accepts category maintenance changes", () => {
    expect(
      updateMenuCategoryRequestSchema.parse({
        name: "Cocktails",
        sortOrder: 2,
        active: false,
      }),
    ).toEqual({ name: "Cocktails", sortOrder: 2, active: false });
  });

  it("rejects an empty update", () => {
    expect(() => updateMenuCategoryRequestSchema.parse({})).toThrow(
      "At least one change is required.",
    );
  });
});

describe("kitchen station updates", () => {
  it("accepts station maintenance changes", () => {
    expect(
      updateKitchenStationRequestSchema.parse({
        name: "Main line",
        displayType: "KITCHEN",
        active: false,
      }),
    ).toEqual({ name: "Main line", displayType: "KITCHEN", active: false });
  });

  it("rejects an empty update", () => {
    expect(() => updateKitchenStationRequestSchema.parse({})).toThrow(
      "At least one change is required.",
    );
  });
});

describe("modifier updates", () => {
  it("accepts option maintenance changes", () => {
    expect(
      updateModifierRequestSchema.parse({
        name: "Large",
        priceDeltaCents: 250,
        active: false,
      }),
    ).toEqual({ name: "Large", priceDeltaCents: 250, active: false });
  });

  it("rejects an empty update", () => {
    expect(() => updateModifierRequestSchema.parse({})).toThrow(
      "At least one change is required.",
    );
  });
});

describe("modifier group updates", () => {
  it("accepts selection-rule changes", () => {
    expect(
      updateModifierGroupRequestSchema.parse({
        name: "Choose toppings",
        selectionType: "MULTIPLE",
        required: true,
        minSelections: 1,
        maxSelections: 3,
      }),
    ).toEqual({
      name: "Choose toppings",
      selectionType: "MULTIPLE",
      required: true,
      minSelections: 1,
      maxSelections: 3,
    });
  });

  it("rejects conflicting limits supplied together", () => {
    expect(() =>
      updateModifierGroupRequestSchema.parse({ minSelections: 3, maxSelections: 2 }),
    ).toThrow("Maximum selections must be at least the minimum.");
  });
});
