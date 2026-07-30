import { Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import {
  RestaurantError,
  RestaurantService as RestaurantDomainService,
} from "@cinema/restaurant";
import { AppError } from "../common/app-error";

@Injectable()
export class RestaurantService {
  private readonly domain = new RestaurantDomainService(prisma);

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

  createMenuCategory(input: { locationId: string; name: string; sortOrder: number }) {
    return this.wrap(() => this.domain.createMenuCategory(input));
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

  sendOrder(input: Parameters<RestaurantDomainService["sendOrder"]>[0]) {
    return this.wrap(() => this.domain.sendOrder(input));
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
