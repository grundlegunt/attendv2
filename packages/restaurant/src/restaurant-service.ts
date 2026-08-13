import {
  FulfillmentTicketStatus,
  KitchenStation,
  MenuCategory,
  Prisma,
  PrismaClient,
} from "@cinema/database";

const summaryInclude = Prisma.validator<Prisma.RestaurantTabInclude>()({
  activePaymentMethod: true,
  primaryCustomer: { select: { id: true, name: true } },
  showtime: { include: { movie: true, auditorium: true } },
  seats: {
    include: {
      ticket: { include: { ticketOrder: true, ticketType: true } },
      showtimeSeat: { include: { seat: true } },
    },
    orderBy: { showtimeSeat: { seat: { label: "asc" } } },
  },
  orders: {
    include: {
      items: { include: { menuItem: true, kitchenStation: true } },
      fulfillmentTickets: {
        include: { kitchenStation: true },
        orderBy: { firedAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  },
});

type SummaryTab = Prisma.RestaurantTabGetPayload<{ include: typeof summaryInclude }>;

export class RestaurantError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID",
  ) {
    super(message);
  }
}

export class RestaurantService {
  constructor(private readonly prisma: PrismaClient) {}

  async getMenu(input: { locationId: string; includeInactive?: boolean }) {
    const [stations, categories] = await Promise.all([
      this.prisma.kitchenStation.findMany({
        where: {
          locationId: input.locationId,
          ...(input.includeInactive ? {} : { active: true }),
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.menuCategory.findMany({
        where: {
          locationId: input.locationId,
          ...(input.includeInactive ? {} : { active: true }),
        },
        include: {
          items: {
            where: input.includeInactive ? {} : { active: true },
            include: {
              kitchenStation: true,
              modifierGroups: {
                where: input.includeInactive ? {} : { active: true },
                include: {
                  modifiers: {
                    where: input.includeInactive ? {} : { active: true },
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  },
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              },
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);
    return { stations, categories };
  }

  async getSeatDetail(input: { locationId: string; showtimeSeatId: string }) {
    const showtimeSeat = await this.prisma.showtimeSeat.findFirst({
      where: {
        id: input.showtimeSeatId,
        showtime: { auditorium: { locationId: input.locationId } },
      },
      include: {
        seat: true,
        showtime: { include: { movie: true, auditorium: true } },
        currentTabSeat: { select: { restaurantTabId: true } },
      },
    });
    if (!showtimeSeat) throw new RestaurantError("Showtime seat was not found.", "NOT_FOUND");
    return {
      id: showtimeSeat.id,
      seat: showtimeSeat.seat.label,
      movie: showtimeSeat.showtime.movie.title,
      auditorium: showtimeSeat.showtime.auditorium.name,
      startsAt: showtimeSeat.showtime.startsAt.toISOString(),
      tab: showtimeSeat.currentTabSeat
        ? await this.getSummary({
            tabId: showtimeSeat.currentTabSeat.restaurantTabId,
            locationId: input.locationId,
          })
        : null,
    };
  }

  async createKitchenStation(input: {
    locationId: string;
    actorId: string;
    name: string;
    displayType: string;
  }): Promise<KitchenStation> {
    return this.prisma.$transaction(async (tx) => {
      const station = await tx.kitchenStation.create({
        data: {
          locationId: input.locationId,
          name: input.name,
          displayType: input.displayType,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "kitchen_station.created",
          entityType: "KitchenStation",
          entityId: station.id,
          locationId: input.locationId,
          afterState: station,
        },
      });
      return station;
    });
  }

  async updateKitchenStation(input: {
    kitchenStationId: string;
    locationId: string;
    actorId: string;
    changes: { name?: string; displayType?: string; active?: boolean };
  }): Promise<KitchenStation> {
    return this.prisma.$transaction(async (tx) => {
      const station = await tx.kitchenStation.findFirst({
        where: { id: input.kitchenStationId, locationId: input.locationId },
      });
      if (!station) throw new RestaurantError("Kitchen station was not found.", "NOT_FOUND");
      if (input.changes.active === false) {
        const assignedItems = await tx.menuItem.count({
          where: { kitchenStationId: station.id, active: true },
        });
        if (assignedItems > 0) {
          throw new RestaurantError(
            "Reassign or deactivate active menu items before retiring this station.",
            "CONFLICT",
          );
        }
      }
      const updated = await tx.kitchenStation.update({
        where: { id: station.id },
        data: input.changes,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "kitchen_station.updated",
          entityType: "KitchenStation",
          entityId: updated.id,
          locationId: input.locationId,
          beforeState: station,
          afterState: updated,
        },
      });
      return updated;
    });
  }

  async createMenuCategory(input: {
    locationId: string;
    actorId: string;
    name: string;
    sortOrder: number;
  }): Promise<MenuCategory> {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.menuCategory.create({
        data: {
          locationId: input.locationId,
          name: input.name,
          sortOrder: input.sortOrder,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "menu_category.created",
          entityType: "MenuCategory",
          entityId: category.id,
          locationId: input.locationId,
          afterState: category,
        },
      });
      return category;
    });
  }

  async updateMenuCategory(input: {
    menuCategoryId: string;
    locationId: string;
    actorId: string;
    changes: { name?: string; sortOrder?: number; active?: boolean };
  }): Promise<MenuCategory> {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.menuCategory.findFirst({
        where: { id: input.menuCategoryId, locationId: input.locationId },
      });
      if (!category) throw new RestaurantError("Menu category was not found.", "NOT_FOUND");
      const updated = await tx.menuCategory.update({
        where: { id: category.id },
        data: input.changes,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "menu_category.updated",
          entityType: "MenuCategory",
          entityId: updated.id,
          locationId: input.locationId,
          beforeState: category,
          afterState: updated,
        },
      });
      return updated;
    });
  }

  async createMenuItem(input: {
    locationId: string;
    actorId: string;
    menuCategoryId: string;
    kitchenStationId: string;
    name: string;
    description?: string;
    imageUrl?: string | null;
    priceCents: number;
    chargeCategory: "FOOD" | "ALCOHOL" | "NA_BEVERAGE";
    isVegan: boolean;
    isGlutenFree: boolean;
    sortOrder: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMenuParents(tx, input);
      const item = await tx.menuItem.create({
        data: {
          menuCategoryId: input.menuCategoryId,
          kitchenStationId: input.kitchenStationId,
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          priceCents: input.priceCents,
          chargeCategory: input.chargeCategory,
          isVegan: input.isVegan,
          isGlutenFree: input.isGlutenFree,
          sortOrder: input.sortOrder,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "menu_item.created",
          entityType: "MenuItem",
          entityId: item.id,
          locationId: input.locationId,
          afterState: item,
        },
      });
      return item;
    });
  }

  async createModifierGroup(input: {
    locationId: string;
    actorId: string;
    menuItemId: string;
    name: string;
    selectionType: "SINGLE" | "MULTIPLE";
    required: boolean;
    minSelections: number;
    maxSelections: number | null;
    sortOrder: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.findFirst({
        where: { id: input.menuItemId, menuCategory: { locationId: input.locationId } },
      });
      if (!item) throw new RestaurantError("Menu item was not found.", "NOT_FOUND");
      const group = await tx.modifierGroup.create({
        data: {
          menuItemId: item.id,
          name: input.name,
          selectionType: input.selectionType,
          required: input.required,
          minSelections: input.minSelections,
          maxSelections: input.maxSelections,
          sortOrder: input.sortOrder,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "modifier_group.created",
          entityType: "ModifierGroup",
          entityId: group.id,
          locationId: input.locationId,
          afterState: {
            menuItemId: item.id,
            name: group.name,
            required: group.required,
          },
        },
      });
      return group;
    });
  }

  async updateModifierGroup(input: {
    locationId: string;
    actorId: string;
    modifierGroupId: string;
    changes: {
      name?: string;
      selectionType?: "SINGLE" | "MULTIPLE";
      required?: boolean;
      minSelections?: number;
      maxSelections?: number | null;
      active?: boolean;
      sortOrder?: number;
    };
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.modifierGroup.findFirst({
        where: {
          id: input.modifierGroupId,
          menuItem: { menuCategory: { locationId: input.locationId } },
        },
      });
      if (!existing) throw new RestaurantError("Modifier group was not found.", "NOT_FOUND");
      const selectionType = input.changes.selectionType ?? existing.selectionType;
      const minSelections = input.changes.minSelections ?? existing.minSelections;
      const maxSelections = input.changes.maxSelections === undefined
        ? existing.maxSelections
        : input.changes.maxSelections;
      if (maxSelections !== null && maxSelections < minSelections) {
        throw new RestaurantError("Maximum selections must be at least the minimum.", "INVALID");
      }
      if (selectionType === "SINGLE" && (minSelections > 1 || (maxSelections ?? 1) > 1)) {
        throw new RestaurantError("Single-choice groups cannot allow more than one selection.", "INVALID");
      }
      const group = await tx.modifierGroup.update({
        where: { id: existing.id },
        data: input.changes,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "modifier_group.updated",
          entityType: "ModifierGroup",
          entityId: group.id,
          locationId: input.locationId,
          beforeState: existing,
          afterState: group,
        },
      });
      return group;
    });
  }

  async createModifier(input: {
    locationId: string;
    actorId: string;
    modifierGroupId: string;
    name: string;
    priceDeltaCents: number;
    sortOrder: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.modifierGroup.findFirst({
        where: {
          id: input.modifierGroupId,
          menuItem: { menuCategory: { locationId: input.locationId } },
        },
      });
      if (!group) throw new RestaurantError("Modifier group was not found.", "NOT_FOUND");
      const modifier = await tx.modifier.create({
        data: {
          modifierGroupId: group.id,
          name: input.name,
          priceDeltaCents: input.priceDeltaCents,
          sortOrder: input.sortOrder,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "modifier.created",
          entityType: "Modifier",
          entityId: modifier.id,
          locationId: input.locationId,
          afterState: {
            modifierGroupId: group.id,
            name: modifier.name,
            priceDeltaCents: modifier.priceDeltaCents,
          },
        },
      });
      return modifier;
    });
  }

  async updateModifier(input: {
    locationId: string;
    actorId: string;
    modifierId: string;
    changes: {
      name?: string;
      priceDeltaCents?: number;
      active?: boolean;
      sortOrder?: number;
    };
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.modifier.findFirst({
        where: {
          id: input.modifierId,
          modifierGroup: { menuItem: { menuCategory: { locationId: input.locationId } } },
        },
      });
      if (!existing) throw new RestaurantError("Modifier was not found.", "NOT_FOUND");
      const modifier = await tx.modifier.update({
        where: { id: existing.id },
        data: input.changes,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "modifier.updated",
          entityType: "Modifier",
          entityId: modifier.id,
          locationId: input.locationId,
          beforeState: {
            name: existing.name,
            priceDeltaCents: existing.priceDeltaCents,
            active: existing.active,
            sortOrder: existing.sortOrder,
          },
          afterState: {
            name: modifier.name,
            priceDeltaCents: modifier.priceDeltaCents,
            active: modifier.active,
            sortOrder: modifier.sortOrder,
          },
        },
      });
      return modifier;
    });
  }

  async updateMenuItem(input: {
    locationId: string;
    actorId: string;
    menuItemId: string;
    changes: {
      name?: string;
      description?: string | null;
      imageUrl?: string | null;
      priceCents?: number;
      chargeCategory?: "FOOD" | "ALCOHOL" | "NA_BEVERAGE";
      isVegan?: boolean;
      isGlutenFree?: boolean;
      active?: boolean;
      is86d?: boolean;
      sortOrder?: number;
      menuCategoryId?: string;
      kitchenStationId?: string;
    };
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.menuItem.findFirst({
        where: { id: input.menuItemId, menuCategory: { locationId: input.locationId } },
      });
      if (!existing) throw new RestaurantError("Menu item was not found.", "NOT_FOUND");
      if (
        input.changes.kitchenStationId &&
        input.changes.kitchenStationId !== existing.kitchenStationId
      ) {
        const station = await tx.kitchenStation.findFirst({
          where: {
            id: input.changes.kitchenStationId,
            locationId: input.locationId,
            active: true,
          },
        });
        if (!station) throw new RestaurantError("Active kitchen station was not found.", "NOT_FOUND");
      }
      if (input.changes.menuCategoryId && input.changes.menuCategoryId !== existing.menuCategoryId) {
        const category = await tx.menuCategory.findFirst({
          where: {
            id: input.changes.menuCategoryId,
            locationId: input.locationId,
            active: true,
          },
        });
        if (!category) throw new RestaurantError("Active menu category was not found.", "NOT_FOUND");
      }
      const updated = await tx.menuItem.update({
        where: { id: existing.id },
        data: input.changes,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: input.changes.is86d === undefined ? "menu_item.updated" : "menu_item.86_changed",
          entityType: "MenuItem",
          entityId: updated.id,
          locationId: input.locationId,
          beforeState: existing,
          afterState: updated,
        },
      });
      return updated;
    });
  }

  async openWalkInTab(input: {
    locationId: string;
    actorId: string;
    label: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const tab = await tx.restaurantTab.create({
        data: {
          locationId: input.locationId,
          tabType: "WALK_IN",
          label: input.label,
          status: "OPEN",
          fulfillmentMode: "SEAT_DELIVERY",
          autoSettleAuthorized: false,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "restaurant_tab.opened",
          entityType: "RestaurantTab",
          entityId: tab.id,
          locationId: input.locationId,
          afterState: { tabType: "WALK_IN", label: input.label },
        },
      });
      return tab;
    });
  }

  async createOrder(input: {
    tabId: string;
    locationId: string;
    actorId: string;
    showtimeSeatId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${input.tabId} FOR UPDATE`,
      );
      const tab = await tx.restaurantTab.findFirst({
        where: {
          id: input.tabId,
          locationId: input.locationId,
          status: { in: ["PREAUTHORIZED", "OPEN", "READY_TO_CLOSE"] },
        },
        include: { seats: true },
      });
      if (!tab) throw new RestaurantError("Open restaurant tab was not found.", "NOT_FOUND");
      if (
        input.showtimeSeatId &&
        !tab.seats.some((seat) => seat.showtimeSeatId === input.showtimeSeatId)
      ) {
        throw new RestaurantError("The selected seat does not belong to this tab.", "INVALID");
      }
      return tx.restaurantOrder.create({
        data: {
          restaurantTabId: tab.id,
          serverEmployeeId: input.actorId,
          showtimeSeatId: input.showtimeSeatId,
        },
      });
    });
  }

  async addOrderItem(input: {
    orderId: string;
    locationId: string;
    menuItemId: string;
    quantity: number;
    modifierIds: string[];
    allergyNotes?: string;
    course?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${input.orderId} FOR UPDATE`,
      );
      const order = await tx.restaurantOrder.findFirst({
        where: {
          id: input.orderId,
          status: "DRAFT",
          restaurantTab: { locationId: input.locationId },
        },
      });
      if (!order) throw new RestaurantError("Draft restaurant order was not found.", "NOT_FOUND");
      const item = await tx.menuItem.findFirst({
        where: {
          id: input.menuItemId,
          active: true,
          menuCategory: { locationId: input.locationId, active: true },
        },
        include: {
          modifierGroups: {
            where: { active: true },
            include: { modifiers: { where: { active: true } } },
          },
        },
      });
      if (!item) throw new RestaurantError("Active menu item was not found.", "NOT_FOUND");
      if (item.is86d) throw new RestaurantError(`${item.name} is currently 86'd.`, "CONFLICT");

      const requested = new Set(input.modifierIds);
      if (requested.size !== input.modifierIds.length) {
        throw new RestaurantError("A modifier cannot be selected more than once.", "INVALID");
      }
      const selections: Array<{ id: string; name: string; priceDeltaCents: number }> = [];
      for (const group of item.modifierGroups) {
        const selected = group.modifiers.filter((modifier) => requested.has(modifier.id));
        const minimum = group.required ? Math.max(1, group.minSelections) : group.minSelections;
        if (
          selected.length < minimum ||
          (typeof group.maxSelections === "number" &&
            selected.length > group.maxSelections)
        ) {
          throw new RestaurantError(`Invalid selections for ${group.name}.`, "INVALID");
        }
        if (group.selectionType === "SINGLE" && selected.length > 1) {
          throw new RestaurantError(`Choose only one option for ${group.name}.`, "INVALID");
        }
        for (const modifier of selected) {
          requested.delete(modifier.id);
          selections.push({
            id: modifier.id,
            name: modifier.name,
            priceDeltaCents: modifier.priceDeltaCents,
          });
        }
      }
      if (requested.size) {
        throw new RestaurantError("One or more modifiers do not belong to this item.", "INVALID");
      }
      return tx.restaurantOrderItem.create({
        data: {
          restaurantOrderId: order.id,
          menuItemId: item.id,
          quantity: input.quantity,
          unitPriceCentsSnapshot: item.priceCents,
          selectedModifiers: selections,
          modifierTotalCents: selections.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0),
          allergyNotes: input.allergyNotes,
          course: input.course,
          kitchenStationId: item.kitchenStationId,
        },
      });
    });
  }

  async removeDraftOrderItem(input: {
    orderId: string;
    orderItemId: string;
    locationId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${input.orderId} FOR UPDATE`,
      );
      const item = await tx.restaurantOrderItem.findFirst({
        where: {
          id: input.orderItemId,
          restaurantOrderId: input.orderId,
          status: "DRAFT",
          restaurantOrder: {
            status: "DRAFT",
            restaurantTab: { locationId: input.locationId },
          },
        },
      });
      if (!item) throw new RestaurantError("Draft order item was not found.", "NOT_FOUND");
      await tx.restaurantOrderItem.delete({ where: { id: item.id } });
      return { removed: true };
    });
  }

  async sendOrder(input: { orderId: string; locationId: string; actorId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${input.orderId} FOR UPDATE`,
      );
      const order = await tx.restaurantOrder.findFirst({
        where: {
          id: input.orderId,
          status: "DRAFT",
          restaurantTab: { locationId: input.locationId },
        },
        include: {
          items: { include: { menuItem: true } },
          serverEmployee: true,
          restaurantTab: {
            include: {
              showtime: { include: { auditorium: true } },
              seats: { include: { showtimeSeat: { include: { seat: true } } } },
            },
          },
        },
      });
      if (!order) throw new RestaurantError("Draft restaurant order was not found.", "NOT_FOUND");
      if (!order.items.length) throw new RestaurantError("An empty order cannot be sent.", "INVALID");

      const menuItemIds = [...new Set(order.items.map((item) => item.menuItemId))].sort();
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "menu_items" WHERE "id" IN (${Prisma.join(menuItemIds)}) ORDER BY "id" FOR UPDATE`,
      );
      const currentMenuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: {
          id: true,
          name: true,
          active: true,
          is86d: true,
          kitchenStationId: true,
        },
      });
      const unavailable = currentMenuItems.filter((item) => !item.active || item.is86d);
      if (unavailable.length === currentMenuItems.length) {
        throw new RestaurantError(
          `Cannot send order: ${unavailable.map((item) => item.name).join(", ")} is unavailable.`,
          "CONFLICT",
        );
      }
      const unavailableMenuItemIds = new Set(unavailable.map((item) => item.id));
      const rejectedItems = order.items.filter((item) =>
        unavailableMenuItemIds.has(item.menuItemId),
      );
      let rejectedOrderId: string | null = null;
      if (rejectedItems.length) {
        const rejectedOrder = await tx.restaurantOrder.create({
          data: {
            restaurantTabId: order.restaurantTabId,
            showtimeSeatId: order.showtimeSeatId,
            serverEmployeeId: order.serverEmployeeId,
          },
        });
        rejectedOrderId = rejectedOrder.id;
        await tx.restaurantOrderItem.updateMany({
          where: { id: { in: rejectedItems.map((item) => item.id) } },
          data: { restaurantOrderId: rejectedOrder.id },
        });
      }
      const sentAt = new Date();
      const currentMenuItemById = new Map(currentMenuItems.map((item) => [item.id, item]));
      const sendableItems = order.items.filter(
        (item) => !unavailableMenuItemIds.has(item.menuItemId),
      );
      await Promise.all(
        sendableItems.map((item) =>
          tx.restaurantOrderItem.update({
            where: { id: item.id },
            data: {
              status: "SENT",
              kitchenStationId: currentMenuItemById.get(item.menuItemId)!.kitchenStationId,
            },
          }),
        ),
      );
      const itemsByStation = new Map<string, string[]>();
      for (const item of sendableItems) {
        const stationId = currentMenuItemById.get(item.menuItemId)!.kitchenStationId;
        itemsByStation.set(stationId, [...(itemsByStation.get(stationId) ?? []), item.id]);
      }
      const fulfillmentTickets = await Promise.all(
        [...itemsByStation.entries()].map(([kitchenStationId, itemIds]) =>
          tx.fulfillmentTicket.create({
            data: {
              restaurantOrderId: order.id,
              kitchenStationId,
              tabLabel: order.restaurantTab.label,
              auditoriumName: order.restaurantTab.showtime?.auditorium.name,
              seatLabels: order.restaurantTab.seats
                .filter(
                  (seat) =>
                    !order.showtimeSeatId ||
                    seat.showtimeSeatId === order.showtimeSeatId,
                )
                .map((seat) => seat.showtimeSeat.seat.label),
              showtimeId: order.restaurantTab.showtimeId,
              showtimeStartsAt: order.restaurantTab.showtime?.startsAt,
              serverName: order.serverEmployee.name,
              items: { connect: itemIds.map((id) => ({ id })) },
            },
          }),
        ),
      );
      const sent = await tx.restaurantOrder.update({
        where: { id: order.id },
        data: { status: "SENT", placedAt: sentAt },
        include: { items: true },
      });
      if (order.restaurantTab.status === "PREAUTHORIZED") {
        await tx.restaurantTab.update({
          where: { id: order.restaurantTab.id },
          data: { status: "OPEN" },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.actorId,
          action: "restaurant_order.sent",
          entityType: "RestaurantOrder",
          entityId: order.id,
          locationId: input.locationId,
          afterState: {
            placedAt: sentAt.toISOString(),
            stationIds: [
              ...new Set(
                sendableItems.map(
                  (item) => currentMenuItemById.get(item.menuItemId)!.kitchenStationId,
                ),
              ),
            ],
            rejectedOrderId,
            rejectedItemIds: rejectedItems.map((item) => item.id),
          },
        },
      });
      return {
        ...sent,
        fulfillmentTickets,
        rejectedDraft: rejectedOrderId
          ? {
              orderId: rejectedOrderId,
              items: rejectedItems.map((item) => ({
                id: item.id,
                menuItemId: item.menuItemId,
                name: item.menuItem.name,
                reason: currentMenuItemById.get(item.menuItemId)!.is86d
                  ? "MENU_ITEM_86D"
                  : "MENU_ITEM_INACTIVE",
              })),
            }
          : null,
      };
    });
  }

  async getFulfillmentStations(input: { locationId: string }) {
    return this.prisma.kitchenStation.findMany({
      where: { locationId: input.locationId, active: true },
      orderBy: { name: "asc" },
    });
  }

  async getFulfillmentQueue(input: {
    locationId: string;
    kitchenStationId: string;
  }) {
    const station = await this.prisma.kitchenStation.findFirst({
      where: {
        id: input.kitchenStationId,
        locationId: input.locationId,
        active: true,
      },
    });
    if (!station) throw new RestaurantError("Kitchen station was not found.", "NOT_FOUND");
    const tickets = await this.prisma.fulfillmentTicket.findMany({
      where: {
        kitchenStationId: station.id,
        status: { in: ["NEW", "ACCEPTED", "PREPARING", "READY"] },
      },
      include: {
        items: { include: { menuItem: true } },
      },
      orderBy: { firedAt: "asc" },
    });
    return { station, tickets };
  }

  async transitionFulfillmentTicket(input: {
    ticketId: string;
    locationId: string;
    actorId: string;
    action: "ACCEPT" | "START" | "READY" | "DELIVER" | "CANCEL" | "VOID" | "REFIRE";
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT ft."id" FROM "fulfillment_tickets" ft
          JOIN "kitchen_stations" ks ON ks."id" = ft."kitchenStationId"
          WHERE ft."id" = ${input.ticketId} AND ks."locationId" = ${input.locationId}
          FOR UPDATE`,
      );
      const ticket = await tx.fulfillmentTicket.findFirst({
        where: {
          id: input.ticketId,
          kitchenStation: { locationId: input.locationId },
        },
        include: { items: true },
      });
      if (!ticket) throw new RestaurantError("Fulfillment ticket was not found.", "NOT_FOUND");

      const transition = this.fulfillmentTransition(ticket.status, input.action);
      const now = new Date();
      if (input.action === "REFIRE") {
        const original = await tx.fulfillmentTicket.update({
          where: { id: ticket.id },
          data: { status: "REFIRE", refireCount: { increment: 1 } },
        });
        const refire = await tx.fulfillmentTicket.create({
          data: {
            restaurantOrderId: ticket.restaurantOrderId,
            kitchenStationId: ticket.kitchenStationId,
            tabLabel: ticket.tabLabel,
            auditoriumName: ticket.auditoriumName,
            seatLabels: ticket.seatLabels,
            showtimeId: ticket.showtimeId,
            showtimeStartsAt: ticket.showtimeStartsAt,
            serverName: ticket.serverName,
            refiredFromId: ticket.id,
            refireCount: original.refireCount,
            items: { connect: ticket.items.map((item) => ({ id: item.id })) },
          },
          include: { items: { include: { menuItem: true } } },
        });
        await this.updateRestaurantOrderRollup(tx, ticket.restaurantOrderId);
        await this.auditFulfillmentTransition(
          tx,
          input,
          ticket.status,
          "REFIRE",
          ticket.id,
          refire.id,
        );
        return refire;
      }

      const updated = await tx.fulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: transition,
          ...(transition === "ACCEPTED" ? { acceptedAt: now } : {}),
          ...(transition === "PREPARING" ? { startedAt: now } : {}),
          ...(transition === "READY" ? { readyAt: now } : {}),
          ...(transition === "DELIVERED" ? { deliveredAt: now } : {}),
        },
        include: { items: { include: { menuItem: true } } },
      });
      await this.updateRestaurantOrderRollup(tx, ticket.restaurantOrderId);
      await this.auditFulfillmentTransition(
        tx,
        input,
        ticket.status,
        transition,
        ticket.id,
      );
      return updated;
    });
  }

  async splitTab(input: {
    tabId: string;
    showtimeSeatId: string;
    locationId: string;
    actorId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${input.tabId} FOR UPDATE`,
      );
      const source = await tx.restaurantTab.findFirst({
        where: {
          id: input.tabId,
          locationId: input.locationId,
          tabType: "SEAT_LINKED",
          status: { in: ["PREAUTHORIZED", "OPEN"] },
        },
        include: { seats: true },
      });
      if (!source) throw new RestaurantError("Open seat-linked tab was not found.", "NOT_FOUND");
      if (source.seats.length < 2) {
        throw new RestaurantError("A one-seat tab cannot be split.", "INVALID");
      }
      const seat = source.seats.find((candidate) => candidate.showtimeSeatId === input.showtimeSeatId);
      if (!seat) throw new RestaurantError("Seat does not belong to this tab.", "NOT_FOUND");
      const target = await tx.restaurantTab.create({
        data: {
          locationId: source.locationId,
          primaryCustomerId: source.primaryCustomerId,
          tabType: source.tabType,
          fulfillmentMode: source.fulfillmentMode,
          showtimeId: source.showtimeId,
          status: "OPEN",
          autoSettleAuthorized: false,
          activePaymentMethodId: null,
          activePaymentMethodSetAt: null,
        },
      });
      await tx.restaurantTabSeat.update({
        where: { id: seat.id },
        data: { restaurantTabId: target.id },
      });
      await tx.restaurantOrder.updateMany({
        where: {
          restaurantTabId: source.id,
          showtimeSeatId: input.showtimeSeatId,
        },
        data: { restaurantTabId: target.id },
      });
      await this.auditTabOperation(tx, input, "restaurant_tab.split", source.id, {
        targetTabId: target.id,
        showtimeSeatId: input.showtimeSeatId,
        paymentAuthorizationInherited: false,
      });
      return { sourceTabId: source.id, targetTabId: target.id };
    });
  }

  async transferOrder(input: {
    orderId: string;
    targetTabId: string;
    locationId: string;
    actorId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.restaurantOrder.findFirst({
        where: { id: input.orderId, restaurantTab: { locationId: input.locationId } },
        include: { restaurantTab: true },
      });
      const target = await tx.restaurantTab.findFirst({
        where: {
          id: input.targetTabId,
          locationId: input.locationId,
          status: { in: ["PREAUTHORIZED", "OPEN"] },
        },
      });
      if (!order || !target) {
        throw new RestaurantError("Order or target tab was not found.", "NOT_FOUND");
      }
      if (order.restaurantTabId === target.id) return order;
      if (order.restaurantTab.showtimeId !== target.showtimeId) {
        throw new RestaurantError("Orders can only move between tabs for the same showtime.", "INVALID");
      }
      const updated = await tx.restaurantOrder.update({
        where: { id: order.id },
        data: { restaurantTabId: target.id },
      });
      await this.auditTabOperation(
        tx,
        input,
        "restaurant_order.transferred",
        order.id,
        { fromTabId: order.restaurantTabId, toTabId: target.id },
        "RestaurantOrder",
      );
      return updated;
    });
  }

  async combineTabs(input: {
    targetTabId: string;
    sourceTabId: string;
    locationId: string;
    actorId: string;
  }) {
    if (input.targetTabId === input.sourceTabId) {
      throw new RestaurantError("A tab cannot be combined with itself.", "INVALID");
    }
    return this.prisma.$transaction(async (tx) => {
      const ids = [input.targetTabId, input.sourceTabId].sort();
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_tabs" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
      );
      const tabs = await tx.restaurantTab.findMany({
        where: {
          id: { in: ids },
          locationId: input.locationId,
          status: { in: ["PREAUTHORIZED", "OPEN"] },
        },
      });
      const target = tabs.find((tab) => tab.id === input.targetTabId);
      const source = tabs.find((tab) => tab.id === input.sourceTabId);
      if (!target || !source) throw new RestaurantError("Open tabs were not found.", "NOT_FOUND");
      if (target.tabType !== source.tabType || target.showtimeId !== source.showtimeId) {
        throw new RestaurantError("Only matching tabs for the same showtime can be combined.", "INVALID");
      }
      await tx.restaurantTabSeat.updateMany({
        where: { restaurantTabId: source.id },
        data: { restaurantTabId: target.id },
      });
      await tx.restaurantOrder.updateMany({
        where: { restaurantTabId: source.id },
        data: { restaurantTabId: target.id },
      });
      await tx.restaurantTab.update({
        where: { id: source.id },
        data: { status: "VOIDED", mergedIntoTabId: target.id },
      });
      await this.auditTabOperation(tx, input, "restaurant_tab.combined", target.id, {
        sourceTabId: source.id,
      });
      return { targetTabId: target.id, sourceTabId: source.id };
    });
  }

  async openSeatLinkedTabs(input: {
    ticketOrderId: string;
    locationId: string;
    actorId: string;
    mode: "SHARED" | "SEPARATE";
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.ticketOrder.findFirst({
        where: {
          id: input.ticketOrderId,
          locationId: input.locationId,
          status: "PAID",
        },
        include: {
          location: true,
          tickets: {
            where: { status: { notIn: ["REFUNDED", "CANCELED"] } },
            include: { showtimeSeat: { include: { showtime: true } } },
            orderBy: { showtimeSeatId: "asc" },
          },
          consents: {
            where: { type: "DINING_AUTO_SETTLEMENT", granted: true },
            include: { paymentMethodReference: true },
            take: 1,
          },
        },
      });
      if (!order?.tickets.length) {
        throw new RestaurantError("Paid ticket order was not found.", "NOT_FOUND");
      }
      const showtimeIds = new Set(order.tickets.map((ticket) => ticket.showtimeSeat.showtimeId));
      if (showtimeIds.size !== 1) {
        throw new RestaurantError("A seat-linked tab must belong to one showtime.", "INVALID");
      }

      const seatIds = order.tickets.map((ticket) => ticket.showtimeSeatId).sort();
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "showtime_seats" WHERE "id" IN (${Prisma.join(seatIds)}) ORDER BY "id" FOR UPDATE`,
      );
      const seats = await tx.showtimeSeat.findMany({
        where: { id: { in: seatIds } },
        select: { id: true, currentTabSeatId: true },
      });
      if (seats.some((seat) => seat.currentTabSeatId)) {
        const existing = await this.summariesForOrder(tx, order.id);
        if (existing.length) {
          // For a one-seat order the two requested arrangements are
          // structurally identical: one tab containing one seat. Treat
          // either literal as an idempotent replay instead of inventing a
          // mode distinction that cannot be recovered from the stored shape.
          if (order.tickets.length === 1) return existing;
          const existingMode =
            existing.length === 1 && existing[0]!.seats.length === order.tickets.length
              ? "SHARED"
              : "SEPARATE";
          if (existingMode !== input.mode) {
            throw new RestaurantError(
              `Tabs for this ticket order were already opened in ${existingMode.toLowerCase()} mode.`,
              "CONFLICT",
            );
          }
          return existing;
        }
        throw new RestaurantError("One or more seats already belong to an open tab.", "CONFLICT");
      }

      const consent = order.consents[0];
      const paymentMethod =
        consent?.paymentMethodReference?.active ? consent.paymentMethodReference : null;
      const groups =
        input.mode === "SHARED"
          ? [order.tickets]
          : order.tickets.map((ticket) => [ticket]);

      for (const tickets of groups) {
        const tab = await tx.restaurantTab.create({
          data: {
            locationId: order.locationId,
            primaryCustomerId: order.customerId,
            tabType: "SEAT_LINKED",
            showtimeId: tickets[0]!.showtimeSeat.showtimeId,
            status: paymentMethod ? "PREAUTHORIZED" : "OPEN",
            autoSettleAuthorized: Boolean(paymentMethod),
            activePaymentMethodId: paymentMethod?.id,
            activePaymentMethodSetAt: paymentMethod ? new Date() : null,
            autoSettleAt: paymentMethod
              ? new Date(
                  tickets[0]!.showtimeSeat.showtime.endsAt.getTime() +
                    order.location.autoSettleGraceMinutes * 60_000,
                )
              : null,
          },
        });
        for (const ticket of tickets) {
          const tabSeat = await tx.restaurantTabSeat.create({
            data: {
              restaurantTabId: tab.id,
              showtimeSeatId: ticket.showtimeSeatId,
              ticketId: ticket.id,
            },
          });
          await tx.showtimeSeat.update({
            where: { id: ticket.showtimeSeatId },
            data: { currentTabSeatId: tabSeat.id },
          });
        }
        await tx.auditEvent.create({
          data: {
            actorType: "EMPLOYEE",
            actorId: input.actorId,
            action: "restaurant_tab.opened",
            entityType: "RestaurantTab",
            entityId: tab.id,
            locationId: order.locationId,
            afterState: {
              mode: input.mode,
              ticketOrderId: order.id,
              showtimeSeatIds: tickets.map((ticket) => ticket.showtimeSeatId),
              autoSettleAuthorized: Boolean(paymentMethod),
            },
          },
        });
      }
      return this.summariesForOrder(tx, order.id);
    });
  }

  async getSummary(input: { tabId: string; locationId: string }) {
    const tab = await this.prisma.restaurantTab.findFirst({
      where: { id: input.tabId, locationId: input.locationId },
      include: summaryInclude,
    });
    if (!tab) throw new RestaurantError("Restaurant tab was not found.", "NOT_FOUND");
    return this.presentSummary(tab);
  }

  private summariesForOrder(tx: Prisma.TransactionClient, ticketOrderId: string) {
    return tx.restaurantTab
      .findMany({
        where: { seats: { some: { ticket: { ticketOrderId } } } },
        include: summaryInclude,
        orderBy: { openedAt: "asc" },
      })
      .then((tabs) => tabs.map((tab) => this.presentSummary(tab)));
  }

  private presentSummary(tab: SummaryTab) {
    return {
      id: tab.id,
      status: tab.status,
      tabType: tab.tabType,
      autoSettleAuthorized: tab.autoSettleAuthorized,
      customer: tab.primaryCustomer,
      showtime: tab.showtime
        ? {
            id: tab.showtime.id,
            movie: tab.showtime.movie.title,
            auditorium: tab.showtime.auditorium.name,
            startsAt: tab.showtime.startsAt.toISOString(),
          }
        : null,
      paymentMethod: tab.activePaymentMethod
        ? {
            brand: tab.activePaymentMethod.brand,
            last4: tab.activePaymentMethod.last4,
          }
        : null,
      seats: tab.seats.map((seat) => ({
        ticketId: seat.ticketId,
        ticketOrderId: seat.ticket.ticketOrderId,
        showtimeSeatId: seat.showtimeSeatId,
        seat: seat.showtimeSeat.seat.label,
        ticketType: seat.ticket.ticketType.name,
      })),
      orders: tab.orders.map((order) => ({
        id: order.id,
        status: order.status,
        showtimeSeatId: order.showtimeSeatId,
        placedAt: order.placedAt?.toISOString() ?? null,
        items: order.items.map((item) => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCentsSnapshot,
          modifierTotalCents: item.modifierTotalCents,
          station: item.kitchenStation.name,
          status: item.status,
        })),
        fulfillment: order.fulfillmentTickets.map((ticket) => ({
          id: ticket.id,
          station: ticket.kitchenStation.name,
          status: ticket.status,
          firedAt: ticket.firedAt.toISOString(),
          readyAt: ticket.readyAt?.toISOString() ?? null,
          deliveredAt: ticket.deliveredAt?.toISOString() ?? null,
          refireCount: ticket.refireCount,
        })),
      })),
    };
  }

  private async requireMenuParents(
    tx: Prisma.TransactionClient,
    input: { locationId: string; menuCategoryId: string; kitchenStationId: string },
  ) {
    const [category, station] = await Promise.all([
      tx.menuCategory.findFirst({
        where: { id: input.menuCategoryId, locationId: input.locationId, active: true },
      }),
      tx.kitchenStation.findFirst({
        where: { id: input.kitchenStationId, locationId: input.locationId, active: true },
      }),
    ]);
    if (!category) throw new RestaurantError("Active menu category was not found.", "NOT_FOUND");
    if (!station) throw new RestaurantError("Active kitchen station was not found.", "NOT_FOUND");
  }

  private auditTabOperation(
    tx: Prisma.TransactionClient,
    input: { locationId: string; actorId: string },
    action: string,
    entityId: string,
    afterState: Prisma.InputJsonValue,
    entityType = "RestaurantTab",
  ) {
    return tx.auditEvent.create({
      data: {
        actorType: "EMPLOYEE",
        actorId: input.actorId,
        action,
        entityType,
        entityId,
        locationId: input.locationId,
        afterState,
      },
    });
  }

  private fulfillmentTransition(
    current: FulfillmentTicketStatus,
    action: "ACCEPT" | "START" | "READY" | "DELIVER" | "CANCEL" | "VOID" | "REFIRE",
  ): FulfillmentTicketStatus {
    const transitions: Partial<
      Record<
        FulfillmentTicketStatus,
        Partial<Record<typeof action, FulfillmentTicketStatus>>
      >
    > = {
      NEW: { ACCEPT: "ACCEPTED", CANCEL: "CANCELED" },
      ACCEPTED: { START: "PREPARING", CANCEL: "CANCELED" },
      PREPARING: { READY: "READY", CANCEL: "CANCELED" },
      READY: { DELIVER: "DELIVERED", VOID: "VOIDED" },
      DELIVERED: { REFIRE: "REFIRE" },
    };
    const next = transitions[current]?.[action];
    if (!next) {
      throw new RestaurantError(
        `Cannot ${action.toLowerCase()} a ${current.toLowerCase()} fulfillment ticket.`,
        "CONFLICT",
      );
    }
    return next;
  }

  private async updateRestaurantOrderRollup(
    tx: Prisma.TransactionClient,
    restaurantOrderId: string,
  ) {
    const tickets = await tx.fulfillmentTicket.findMany({
      where: { restaurantOrderId },
      include: { _count: { select: { refires: true } } },
    });
    const currentCycles = tickets.filter((ticket) => ticket._count.refires === 0);
    const statuses = currentCycles.map((ticket) => ticket.status);
    const delivered = statuses.filter((status) => status === "DELIVERED").length;
    const allCanceledOrVoided = statuses.every(
      (candidate) => candidate === "CANCELED" || candidate === "VOIDED",
    );
    const hasProgressHistory = tickets.some((ticket) => ticket.status !== "NEW");
    const status =
      allCanceledOrVoided
        ? "CANCELED"
        : delivered === statuses.length
        ? "DELIVERED"
        : delivered > 0
          ? "PARTIALLY_DELIVERED"
          : statuses.every((candidate) => candidate === "NEW") && !hasProgressHistory
            ? "SENT"
            : "IN_PROGRESS";
    await tx.restaurantOrder.update({
      where: { id: restaurantOrderId },
      data: { status },
    });
  }

  private auditFulfillmentTransition(
    tx: Prisma.TransactionClient,
    input: { locationId: string; actorId: string; action: string },
    beforeStatus: FulfillmentTicketStatus,
    afterStatus: FulfillmentTicketStatus,
    entityId: string,
    refireTicketId?: string,
  ) {
    return tx.auditEvent.create({
      data: {
        actorType: "EMPLOYEE",
        actorId: input.actorId,
        action:
          input.action === "REFIRE"
            ? "fulfillment_ticket.refired"
            : "fulfillment_ticket.status_changed",
        entityType: "FulfillmentTicket",
        entityId,
        locationId: input.locationId,
        beforeState: { status: beforeStatus },
        afterState: {
          status: afterStatus,
          action: input.action,
          refireTicketId: refireTicketId ?? null,
        },
      },
    });
  }
}
