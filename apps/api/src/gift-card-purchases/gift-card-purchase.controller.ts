import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createGiftCardPurchaseSchema } from "@cinema/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { GiftCardPurchaseService } from "./gift-card-purchase.service";

@Controller("gift-card-purchases")
@UseGuards(RequestRateLimitGuard)
@RateLimit({ scope: "checkout" })
export class GiftCardPurchaseController {
  constructor(private readonly purchases: GiftCardPurchaseService) {}

  @Get("config")
  config(@Query("locationId") locationId?: string) { return this.purchases.config(locationId); }

  @Post()
  create(@Headers("idempotency-key") idempotencyKey: string | undefined, @Body(new ZodValidationPipe(createGiftCardPurchaseSchema)) body: unknown) {
    return this.purchases.create({ ...createGiftCardPurchaseSchema.parse(body), idempotencyKey: idempotencyKey ?? "" });
  }

  @Post(":purchaseId/finalize")
  finalize(@Param("purchaseId") purchaseId: string, @Headers("idempotency-key") purchaseKey: string | undefined) {
    return this.purchases.finalize(purchaseId, purchaseKey ?? "");
  }

  @Post(":purchaseId/delivery")
  deliver(@Param("purchaseId") purchaseId: string, @Headers("idempotency-key") purchaseKey: string | undefined) {
    return this.purchases.deliverAuthorized(purchaseId, purchaseKey ?? "");
  }
}
