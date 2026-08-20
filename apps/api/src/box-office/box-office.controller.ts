import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { boxOfficeCheckoutRequestSchema, boxOfficeHoldRequestSchema, boxOfficeQuoteRequestSchema, cashMovementRequestSchema, closeCashDrawerRequestSchema, giftCardBalanceRequestSchema, openCashDrawerRequestSchema, seatBlockRequestSchema, ticketExchangeRequestSchema, ticketReceiptResendRequestSchema, ticketRefundRequestSchema } from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BoxOfficeService } from "./box-office.service";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Controller("box-office")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.SeatSell)
export class BoxOfficeController {
  constructor(private readonly boxOffice: BoxOfficeService) {}

  @Post("cash-drawers")
  open(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(openCashDrawerRequestSchema)) body: unknown) {
    return this.boxOffice.openDrawer({ ...openCashDrawerRequestSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub });
  }

  @Get("cash-drawers/active")
  active(@CurrentActor() actor: RequestActor, @Query("registerId") registerId = "") {
    if (!registerId.trim()) throw AppError.validationFailed("Register id is required.");
    return this.boxOffice.activeDrawer(this.location(actor), registerId.trim());
  }

  @Post("cash-drawers/:drawerId/movements")
  movement(@CurrentActor() actor: RequestActor, @Param("drawerId") drawerId: string, @Body(new ZodValidationPipe(cashMovementRequestSchema)) body: unknown) {
    return this.boxOffice.recordMovement({ ...cashMovementRequestSchema.parse(body), drawerId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("cash-drawers/:drawerId/close")
  close(@CurrentActor() actor: RequestActor, @Param("drawerId") drawerId: string, @Body(new ZodValidationPipe(closeCashDrawerRequestSchema)) body: unknown) {
    return this.boxOffice.closeDrawer({ ...closeCashDrawerRequestSchema.parse(body), drawerId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("showtimes/:showtimeId/holds")
  hold(@CurrentActor() actor: RequestActor, @Param("showtimeId") showtimeId: string, @Body(new ZodValidationPipe(boxOfficeHoldRequestSchema)) body: unknown) {
    const parsed = boxOfficeHoldRequestSchema.parse(body);
    return this.boxOffice.holdSeats(showtimeId, parsed.seatIds, parsed.holderKey, this.location(actor));
  }

  @Post("quotes")
  quote(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(boxOfficeQuoteRequestSchema)) body: unknown) {
    return this.boxOffice.quote({ ...boxOfficeQuoteRequestSchema.parse(body), locationId: this.location(actor) });
  }

  @Post("gift-cards/balance")
  giftCardBalance(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(giftCardBalanceRequestSchema)) body: unknown) {
    return this.boxOffice.giftCardBalance(this.location(actor), giftCardBalanceRequestSchema.parse(body).code);
  }

  @Post("checkouts")
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard, PermissionsGuard)
  @RateLimit({ scope: "checkout", identity: "actor" })
  checkout(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(boxOfficeCheckoutRequestSchema)) body: unknown) {
    return this.boxOffice.checkout({ ...boxOfficeCheckoutRequestSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("showtime-seats/:inventoryId/block")
  @RequirePermissions(Permission.SeatBlock)
  block(@CurrentActor() actor: RequestActor, @Param("inventoryId") inventoryId: string, @Body(new ZodValidationPipe(seatBlockRequestSchema)) body: unknown) {
    return this.boxOffice.setSeatBlocked({ ...seatBlockRequestSchema.parse(body), inventoryId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("tickets/:ticketId/reprint")
  reprint(@CurrentActor() actor: RequestActor, @Param("ticketId") ticketId: string) {
    return this.boxOffice.reprint(ticketId, this.location(actor), actor.sub);
  }

  @Post("orders/:orderId/receipt")
  resendReceipt(@CurrentActor() actor: RequestActor, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(ticketReceiptResendRequestSchema)) body: unknown) {
    return this.boxOffice.resendReceipt({ ...ticketReceiptResendRequestSchema.parse(body), orderId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("orders/:orderId/refund")
  @RequirePermissions(Permission.TicketRefund)
  refund(@CurrentActor() actor: RequestActor, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(ticketRefundRequestSchema)) body: unknown) {
    return this.boxOffice.refundOrder({ ...ticketRefundRequestSchema.parse(body), orderId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Post("tickets/:ticketId/exchange")
  @RequirePermissions(Permission.TicketRefund)
  refundTicket(@CurrentActor() actor: RequestActor, @Param("ticketId") ticketId: string, @Body(new ZodValidationPipe(ticketExchangeRequestSchema)) body: unknown) {
    return this.boxOffice.exchangeTicket({ ...ticketExchangeRequestSchema.parse(body), ticketId, locationId: this.location(actor), employeeId: actor.sub });
  }

  @Get("attention")
  attention(@CurrentActor() actor: RequestActor) {
    return this.boxOffice.attentionRequired(this.location(actor));
  }

  @Get("orders")
  orders(@CurrentActor() actor: RequestActor, @Query("q") query = "") {
    return this.boxOffice.orderLookup(this.location(actor), query);
  }

  @Get("customers")
  customers(@CurrentActor() actor: RequestActor, @Query("q") query = "") {
    return this.boxOffice.customerLookup(this.location(actor), query);
  }

  private location(actor: RequestActor) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return actor.locationId;
  }
}
