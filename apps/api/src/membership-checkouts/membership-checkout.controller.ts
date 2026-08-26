import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { createMembershipCheckoutSchema } from "@cinema/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { MembershipCheckoutService } from "./membership-checkout.service";

@Controller("membership-checkouts")
@UseGuards(RequestRateLimitGuard)
@RateLimit({ scope: "checkout" })
export class MembershipCheckoutController {
  constructor(private readonly checkouts: MembershipCheckoutService) {}
  @Get("config") config(@Query("locationId") locationId?: string) { return this.checkouts.config(locationId); }
  @Post() create(@Headers("idempotency-key") key: string | undefined, @Body(new ZodValidationPipe(createMembershipCheckoutSchema)) body: unknown) { return this.checkouts.create({ ...createMembershipCheckoutSchema.parse(body), idempotencyKey: key ?? "" }); }
  @Post("resume") resume(@Headers("idempotency-key") key: string | undefined) { return this.checkouts.resume(key ?? ""); }
  @Post(":checkoutId/finalize") finalize(@Param("checkoutId") id: string, @Headers("idempotency-key") key: string | undefined) { return this.checkouts.finalize(id, key ?? ""); }
}
