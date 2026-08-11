import {
  createMenuItemRequestSchema,
  updateMenuCategoryRequestSchema,
  updateMenuItemRequestSchema,
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
