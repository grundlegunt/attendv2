import { PublicRestaurantTabController } from "./restaurant-settlement.controller";

describe("PublicRestaurantTabController customer ordering", () => {
  it("binds every order mutation to the tab and location authorized by the signed token", async () => {
    const context = { tabId: "11111111-1111-4111-8111-111111111111", locationId: "22222222-2222-4222-8222-222222222222", customerId: "33333333-3333-4333-8333-333333333333" };
    const settlement = { guestOrderContext: jest.fn().mockResolvedValue(context) };
    const restaurant = {
      createOrder: jest.fn().mockResolvedValue({ id: "order" }),
      addOrderItem: jest.fn().mockResolvedValue({ id: "item" }),
      sendOrder: jest.fn().mockResolvedValue({ id: "order" }),
    };
    const controller = new PublicRestaurantTabController(settlement as never, restaurant as never);
    const orderId = "44444444-4444-4444-8444-444444444444";
    const menuItemId = "55555555-5555-4555-8555-555555555555";

    await controller.createOrder("signed-token", {});
    await controller.addOrderItem("signed-token", orderId, { menuItemId, quantity: 1, modifierIds: [] });
    await controller.sendOrder("signed-token", orderId, {});

    expect(settlement.guestOrderContext).toHaveBeenCalledTimes(3);
    expect(restaurant.createOrder).toHaveBeenCalledWith(expect.objectContaining({ tabId: context.tabId, locationId: context.locationId, actorId: context.customerId, actorType: "CUSTOMER" }));
    expect(restaurant.addOrderItem).toHaveBeenCalledWith(expect.objectContaining({ orderId, restaurantTabId: context.tabId, locationId: context.locationId }));
    expect(restaurant.sendOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId, restaurantTabId: context.tabId, locationId: context.locationId, actorId: context.customerId, actorType: "CUSTOMER" }));
  });
});
