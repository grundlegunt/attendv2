import { Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import {
  RestaurantError,
  RestaurantService as RestaurantDomainService,
} from "@cinema/restaurant";
import { AppError } from "../common/app-error";
import { FulfillmentEventsService } from "./fulfillment-events.service";

@Injectable()
export class RestaurantService {
  private readonly domain = new RestaurantDomainService(prisma);

  constructor(private readonly fulfillmentEvents: FulfillmentEventsService) {}

  openSeatLinkedTabs(input: {
    ticketOrderId: string;
    locationId: string;
    actorId: string;
    mode: "SHARED" | "SEPARATE";
  }) {
    return this.wrap(() => this.domain.openSeatLinkedTabs(input));
  }

  getSummary(input: { tabId: string; locationId: string }) {
    return this.wrap(() => this.domain.getSummary(input));
  }

  getMenu(input: { locationId: string; includeInactive?: boolean }) {
    return this.wrap(() => this.domain.getMenu(input));
  }

  getSeatDetail(input: Parameters<RestaurantDomainService["getSeatDetail"]>[0]) {
    return this.wrap(() => this.domain.getSeatDetail(input));
  }

  createKitchenStation(input: { locationId: string; name: string; displayType: string }) {
    return this.wrap(() => this.domain.createKitchenStation(input));
  }

  updateKitchenStation(input: Parameters<RestaurantDomainService["updateKitchenStation"]>[0]) {
    return this.wrap(() => this.domain.updateKitchenStation(input));
  }

  createMenuCategory(input: { locationId: string; name: string; sortOrder: number }) {
    return this.wrap(() => this.domain.createMenuCategory(input));
  }

  updateMenuCategory(input: Parameters<RestaurantDomainService["updateMenuCategory"]>[0]) {
    return this.wrap(() => this.domain.updateMenuCategory(input));
  }

  createMenuItem(input: Parameters<RestaurantDomainService["createMenuItem"]>[0]) {
    return this.wrap(() => this.domain.createMenuItem(input));
  }

  createModifierGroup(input: Parameters<RestaurantDomainService["createModifierGroup"]>[0]) {
    return this.wrap(() => this.domain.createModifierGroup(input));
  }

  createModifier(input: Parameters<RestaurantDomainService["createModifier"]>[0]) {
    return this.wrap(() => this.domain.createModifier(input));
  }

  updateMenuItem(input: Parameters<RestaurantDomainService["updateMenuItem"]>[0]) {
    return this.wrap(() => this.domain.updateMenuItem(input));
  }

  openWalkInTab(input: Parameters<RestaurantDomainService["openWalkInTab"]>[0]) {
    return this.wrap(() => this.domain.openWalkInTab(input));
  }

  createOrder(input: Parameters<RestaurantDomainService["createOrder"]>[0]) {
    return this.wrap(() => this.domain.createOrder(input));
  }

  addOrderItem(input: Parameters<RestaurantDomainService["addOrderItem"]>[0]) {
    return this.wrap(() => this.domain.addOrderItem(input));
  }

  removeDraftOrderItem(
    input: Parameters<RestaurantDomainService["removeDraftOrderItem"]>[0],
  ) {
    return this.wrap(() => this.domain.removeDraftOrderItem(input));
  }

  async sendOrder(input: Parameters<RestaurantDomainService["sendOrder"]>[0]) {
    const result = await this.wrap(() => this.domain.sendOrder(input));
    for (const ticket of result.fulfillmentTickets) {
      this.fulfillmentEvents.publish({
        locationId: input.locationId,
        kitchenStationId: ticket.kitchenStationId,
        type: "TICKET_CREATED",
        ticketId: ticket.id,
      });
    }
    return result;
  }

  splitTab(input: Parameters<RestaurantDomainService["splitTab"]>[0]) {
    return this.wrap(() => this.domain.splitTab(input));
  }

  transferOrder(input: Parameters<RestaurantDomainService["transferOrder"]>[0]) {
    return this.wrap(() => this.domain.transferOrder(input));
  }

  combineTabs(input: Parameters<RestaurantDomainService["combineTabs"]>[0]) {
    return this.wrap(() => this.domain.combineTabs(input));
  }

  getFulfillmentStations(
    input: Parameters<RestaurantDomainService["getFulfillmentStations"]>[0],
  ) {
    return this.wrap(() => this.domain.getFulfillmentStations(input));
  }

  getFulfillmentQueue(
    input: Parameters<RestaurantDomainService["getFulfillmentQueue"]>[0],
  ) {
    return this.wrap(() => this.domain.getFulfillmentQueue(input));
  }

  async transitionFulfillmentTicket(
    input: Parameters<RestaurantDomainService["transitionFulfillmentTicket"]>[0],
  ) {
    const ticket = await this.wrap(() =>
      this.domain.transitionFulfillmentTicket(input),
    );
    this.fulfillmentEvents.publish({
      locationId: input.locationId,
      kitchenStationId: ticket.kitchenStationId,
      type: "TICKET_UPDATED",
      ticketId: ticket.id,
    });
    return ticket;
  }

  private async wrap<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RestaurantError)) throw error;
      if (error.code === "NOT_FOUND") throw AppError.notFound(error.message);
      if (error.code === "INVALID") throw AppError.validationFailed(error.message);
      throw AppError.conflict(error.message);
    }
  }
}
