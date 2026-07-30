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
