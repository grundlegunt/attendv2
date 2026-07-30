import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Permission } from "@cinema/auth";
import {
  customerPayRestaurantTabRequestSchema,
  finalizeRestaurantTabRequestSchema,
  restaurantTipRequestSchema,
} from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RestaurantSettlementService } from "./restaurant-settlement.service";

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
    return this.settlement.selectTip(
      tabId,
      this.customerId(actor),
      restaurantTipRequestSchema.parse(body).tipCents,
    );
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
  constructor(private readonly settlement: RestaurantSettlementService) {}

  @Get(":token")
  tab(@Param("token") token: string) {
    return this.settlement.guestTab(token);
  }

  @Post(":token/tip")
  tip(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(restaurantTipRequestSchema)) body: unknown,
  ) {
    return this.settlement.selectGuestTip(
      token,
      restaurantTipRequestSchema.parse(body).tipCents,
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
}
