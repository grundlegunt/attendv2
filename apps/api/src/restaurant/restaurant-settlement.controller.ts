import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Permission } from "@cinema/auth";
import {
  addRestaurantOrderItemRequestSchema,
  createRestaurantOrderRequestSchema,
  customerPayRestaurantTabRequestSchema,
  finalizeRestaurantTabRequestSchema,
  restaurantTipRequestSchema,
  sendRestaurantOrderRequestSchema,
} from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RestaurantSettlementService } from "./restaurant-settlement.service";
import { RestaurantService } from "./restaurant.service";

@Controller("restaurant-settlement")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.RestaurantOrderCreate)
export class RestaurantSettlementController {
  constructor(private readonly settlement: RestaurantSettlementService) {}

  @Get("checks-due")
  checksDue(@CurrentActor() actor: RequestActor) {
    return this.settlement.checksDue(this.locationId(actor));
  }

  @Get("attention")
  attention(@CurrentActor() actor: RequestActor) {
    return this.settlementChecksNeedingAttention(this.locationId(actor));
  }

  @Get("tabs/:tabId")
  tab(@CurrentActor() actor: RequestActor, @Param("tabId") tabId: string) {
    return this.settlement.staffTab(tabId, this.locationId(actor));
  }

  @Post("tabs/:tabId/drop-check")
  dropCheck(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
  ) {
    return this.settlement.dropCheck({
      tabId,
      locationId: this.locationId(actor),
      employeeId: actor.sub,
    });
  }

  @Post("tabs/:tabId/access-link")
  accessLink(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
  ) {
    return this.settlement.issueGuestAccess(tabId, this.locationId(actor));
  }

  @Post("tabs/:tabId/finalize")
  finalize(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
    @Body(new ZodValidationPipe(finalizeRestaurantTabRequestSchema))
    body: unknown,
  ) {
    return this.settlement.finalizeStaff({
      ...finalizeRestaurantTabRequestSchema.parse(body),
      tabId,
      locationId: this.locationId(actor),
      employeeId: actor.sub,
    });
  }

  private async settlementChecksNeedingAttention(locationId: string) {
    const { prisma } = await import("@cinema/database");
    return prisma.restaurantTab.findMany({
      where: {
        locationId,
        status: { in: ["PAYMENT_FAILED", "MANAGER_REVIEW"] },
      },
      include: {
        activePaymentMethod: {
          select: { brand: true, last4: true },
        },
        showtime: { include: { movie: true, auditorium: true } },
      },
      orderBy: { updatedAt: "asc" },
    });
  }

  private locationId(actor: RequestActor) {
    if (!actor.locationId) {
      throw AppError.unauthenticated("Staff session is missing its location.");
    }
    return actor.locationId;
  }
}

@Controller("customer/restaurant-tabs")
@UseGuards(JwtAuthGuard)
export class CustomerRestaurantTabController {
  constructor(private readonly settlement: RestaurantSettlementService) {}

  @Get(":tabId")
  tab(@CurrentActor() actor: RequestActor, @Param("tabId") tabId: string) {
    return this.settlement.customerTab(tabId, this.customerId(actor));
  }

  @Post(":tabId/tip")
  tip(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
    @Body(new ZodValidationPipe(restaurantTipRequestSchema)) body: unknown,
  ) {
    const parsed = restaurantTipRequestSchema.parse(body);
    return this.settlement.selectTip({
      tabId,
      customerId: this.customerId(actor),
      requestId: parsed.requestId ?? randomUUID(),
      tipCents: parsed.tipCents,
    });
  }

  @Post(":tabId/pay")
  pay(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
    @Body(new ZodValidationPipe(customerPayRestaurantTabRequestSchema))
    body: unknown,
  ) {
    return this.settlement.payCustomer({
      ...customerPayRestaurantTabRequestSchema.parse(body),
      tabId,
      customerId: this.customerId(actor),
    });
  }

  private customerId(actor: RequestActor) {
    if (actor.actorType !== "CUSTOMER") {
      throw AppError.forbidden("Customer access is required.");
    }
    return actor.sub;
  }
}

@Controller("public/restaurant-tabs")
export class PublicRestaurantTabController {
  constructor(private readonly settlement: RestaurantSettlementService, private readonly restaurant: RestaurantService) {}

  @Get(":token")
  tab(@Param("token") token: string) {
    return this.settlement.guestTab(token);
  }

  @Post(":token/tip")
  tip(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(restaurantTipRequestSchema)) body: unknown,
  ) {
    const parsed = restaurantTipRequestSchema.parse(body);
    return this.settlement.selectGuestTip(
      token,
      parsed.tipCents,
      parsed.requestId ?? randomUUID(),
    );
  }

  @Post(":token/pay")
  pay(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(customerPayRestaurantTabRequestSchema))
    body: unknown,
  ) {
    return this.settlement.payGuest({
      ...customerPayRestaurantTabRequestSchema.parse(body),
      token,
    });
  }

  @Post(":token/orders")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  async createOrder(@Param("token") token: string, @Body(new ZodValidationPipe(createRestaurantOrderRequestSchema)) body: unknown) {
    const context = await this.settlement.guestOrderContext(token);
    const parsed = createRestaurantOrderRequestSchema.parse(body);
    return this.restaurant.createOrder({ ...parsed, requestId: parsed.requestId ?? randomUUID(), tabId: context.tabId, locationId: context.locationId, actorId: context.customerId, actorType: "CUSTOMER" });
  }

  @Post(":token/orders/:orderId/items")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  async addOrderItem(@Param("token") token: string, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(addRestaurantOrderItemRequestSchema)) body: unknown) {
    const context = await this.settlement.guestOrderContext(token);
    const parsed = addRestaurantOrderItemRequestSchema.parse(body);
    return this.restaurant.addOrderItem({ ...parsed, requestId: parsed.requestId ?? randomUUID(), orderId, restaurantTabId: context.tabId, locationId: context.locationId });
  }

  @Post(":token/orders/:orderId/send")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  async sendOrder(@Param("token") token: string, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(sendRestaurantOrderRequestSchema)) body: unknown) {
    const context = await this.settlement.guestOrderContext(token);
    const parsed = sendRestaurantOrderRequestSchema.parse(body);
    return this.restaurant.sendOrder({ orderId, requestId: parsed.requestId ?? randomUUID(), restaurantTabId: context.tabId, locationId: context.locationId, actorId: context.customerId, actorType: "CUSTOMER" });
  }
}
