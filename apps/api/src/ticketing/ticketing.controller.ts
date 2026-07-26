import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { createTicketCheckoutRequestSchema } from "@cinema/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TicketingService } from "./ticketing.service";

@Controller("ticketing")
export class TicketingController {
  constructor(private readonly ticketingService: TicketingService) {}

  @Get("showtimes/:showtimeId/checkout-config")
  checkoutConfig(@Param("showtimeId") showtimeId: string) {
    return this.ticketingService.checkoutConfig(showtimeId);
  }

  @Post("checkouts")
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

  @Post("orders/:orderId/finalize")
  finalize(@Param("orderId") orderId: string) {
    return this.ticketingService.finalizeOrder(orderId);
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
