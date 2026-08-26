import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createDonationCheckoutSchema } from "@cinema/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { DonationCheckoutService } from "./donation-checkout.service";

@Controller("donation-checkouts")
@UseGuards(RequestRateLimitGuard)
@RateLimit({ scope: "checkout" })
export class DonationCheckoutController {
  constructor(private readonly checkouts: DonationCheckoutService) {}
  @Get("config") config(@Query("locationId") locationId?: string) { return this.checkouts.config(locationId); }
  @Post() create(@Headers("idempotency-key") key: string | undefined, @Body(new ZodValidationPipe(createDonationCheckoutSchema)) body: unknown) { return this.checkouts.create({ ...createDonationCheckoutSchema.parse(body), idempotencyKey: key ?? "" }); }
  @Post("resume") resume(@Headers("idempotency-key") key: string | undefined) { return this.checkouts.resume(key ?? ""); }
  @Post(":checkoutId/finalize") finalize(@Param("checkoutId") id: string, @Headers("idempotency-key") key: string | undefined) { return this.checkouts.finalize(id, key ?? ""); }
}
