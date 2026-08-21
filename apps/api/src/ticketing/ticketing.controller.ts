import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { createTicketCheckoutRequestSchema, finalizeTicketOrderRequestSchema, resendGuestTicketReceiptRequestSchema, resumeTicketCheckoutRequestSchema, scanTicketRequestSchema } from "@cinema/shared";
import { Permission } from "@cinema/auth";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TicketingService } from "./ticketing.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ScanRateLimitGuard } from "./scan-rate-limit.guard";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Controller("ticketing")
export class TicketingController {
  constructor(private readonly ticketingService: TicketingService) {}

  @Get("showtimes/:showtimeId/checkout-config")
  checkoutConfig(@Param("showtimeId") showtimeId: string) {
    return this.ticketingService.checkoutConfig(showtimeId);
  }

  @Post("checkouts")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  createCheckout(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTicketCheckoutRequestSchema)) body: unknown,
  ) {
    const parsed = createTicketCheckoutRequestSchema.parse(body);
    return this.ticketingService.createCheckout({
      ...parsed,
      checkoutIdempotencyKey: idempotencyKey ?? "",
    });
  }

  @Post("checkouts/resume")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  resumeCheckout(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(resumeTicketCheckoutRequestSchema)) body: unknown,
  ) {
    const parsed = resumeTicketCheckoutRequestSchema.parse(body);
    return this.ticketingService.resumeCheckout({
      ...parsed,
      checkoutIdempotencyKey: idempotencyKey ?? "",
    });
  }

  @Post("orders/:orderId/finalize")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  finalize(
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(finalizeTicketOrderRequestSchema)) body: unknown,
  ) {
    const parsed = finalizeTicketOrderRequestSchema.parse(body);
    return this.ticketingService.finalizeGuestOrder(orderId, parsed.holderKey);
  }

  @Post("orders/:orderId/receipt")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  resendGuestReceipt(
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(resendGuestTicketReceiptRequestSchema)) body: unknown,
  ) {
    const parsed = resendGuestTicketReceiptRequestSchema.parse(body);
    return this.ticketingService.resendGuestReceipt(orderId, parsed.holderKey, parsed.requestId);
  }

  @Post("scans")
  @UseGuards(JwtAuthGuard, ScanRateLimitGuard, PermissionsGuard)
  @RequirePermissions(Permission.TicketScan)
  scan(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(scanTicketRequestSchema)) body: unknown,
  ) {
    const parsed = scanTicketRequestSchema.parse(body);
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return this.ticketingService.scanTicket({
      ...parsed,
      employeeId: actor.sub,
      locationId: actor.locationId,
    });
  }

  @Post("webhooks/stripe")
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    if (!request.rawBody || !signature) {
      return this.ticketingService.processWebhook(
        Buffer.from(""),
        signature ?? "",
      );
    }
    return this.ticketingService.processWebhook(request.rawBody, signature);
  }
}
