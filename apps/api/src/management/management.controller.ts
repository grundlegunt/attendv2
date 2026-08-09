import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ManagementService } from "./management.service";
import { ManagementRefundService } from "./management-refund.service";

const locationSchema = z.object({ timeClockEnabled: z.boolean().optional(), ticketTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional() }).strict();
const appliesTo = z.enum(["ALL", "FOOD", "ALCOHOL", "NA_BEVERAGE"]);
const taxSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: z.number().int().min(0).max(1000), active: z.boolean().default(true) }).strict();
const serviceSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: z.number().int().min(0).max(1000).optional(), flatCents: z.number().int().min(0).optional(), autoApply: z.boolean().default(true), active: z.boolean().default(true) }).strict();
const promotionSchema = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1).max(100), type: z.enum(["FIXED_AMOUNT", "PERCENTAGE", "COMP"]), amountCents: z.number().int().positive().optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).optional(), active: z.boolean().default(true), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).strict();
const employeeSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email(), password: z.string().min(12).max(200), pin: z.string().regex(/^\d{4,8}$/).optional(), roleIds: z.array(z.string().uuid()).min(1) }).strict();
const employeeUpdateSchema = z.object({ active: z.boolean().optional(), roleIds: z.array(z.string().uuid()).min(1).optional() }).strict();
const employeeCredentialsSchema = z.object({ password: z.string().min(12).max(200).optional(), pin: z.string().regex(/^\d{4,8}$/).nullable().optional() }).strict().refine((value) => value.password !== undefined || value.pin !== undefined, "Provide a password or PIN reset.");
const rolePermissionsSchema = z.object({ permissionKeys: z.array(z.string()).max(100) }).strict();
const refundSchema = z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(1).max(500), cashDrawerId: z.string().uuid().optional() }).strict();

@Controller("management")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ManagementController {
  constructor(private readonly management: ManagementService, private readonly refunds: ManagementRefundService) {}

  @Get("settings") @RequirePermissions(Permission.TicketPriceEdit)
  settings(@CurrentActor() actor: RequestActor) { return this.management.settings(this.location(actor)); }

  @Patch("settings/location") @RequirePermissions(Permission.TicketPriceEdit)
  updateLocation(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(locationSchema)) body: unknown) { return this.management.updateLocation({ ...locationSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("settings/tax-rules") @RequirePermissions(Permission.MenuEdit)
  tax(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(taxSchema)) body: unknown) { return this.management.createTaxRule({ ...taxSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("settings/service-charge-rules") @RequirePermissions(Permission.MenuEdit)
  service(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(serviceSchema)) body: unknown) { return this.management.createServiceCharge({ ...serviceSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("settings/promotions") @RequirePermissions(Permission.TicketPriceEdit)
  promotion(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(promotionSchema)) body: unknown) { return this.management.createPromotion({ ...promotionSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Get("people") @RequirePermissions(Permission.EmployeeEdit)
  people(@CurrentActor() actor: RequestActor) { return this.management.people(this.location(actor)); }

  @Get("customers/:customerId") @RequirePermissions(Permission.PaymentViewDisplaySafe)
  customer(@CurrentActor() actor: RequestActor, @Param("customerId") customerId: string) { return this.management.customer(this.location(actor), customerId); }

  @Get("payment-methods/:paymentMethodId") @RequirePermissions(Permission.PaymentViewDisplaySafe)
  paymentMethod(@CurrentActor() actor: RequestActor, @Param("paymentMethodId") paymentMethodId: string) { return this.management.paymentMethod(this.location(actor), paymentMethodId); }

  @Post("employees") @RequirePermissions(Permission.EmployeeCreate)
  employee(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(employeeSchema)) body: unknown) { return this.management.createEmployee({ ...employeeSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Patch("employees/:employeeId") @RequirePermissions(Permission.EmployeeEdit)
  updateEmployee(@CurrentActor() actor: RequestActor, @Param("employeeId") employeeId: string, @Body(new ZodValidationPipe(employeeUpdateSchema)) body: unknown) { return this.management.updateEmployee({ ...employeeUpdateSchema.parse(body), locationId: this.location(actor), actorId: actor.sub, targetId: employeeId }); }

  @Patch("employees/:employeeId/credentials") @RequirePermissions(Permission.EmployeeEdit)
  resetEmployeeCredentials(@CurrentActor() actor: RequestActor, @Param("employeeId") employeeId: string, @Body(new ZodValidationPipe(employeeCredentialsSchema)) body: unknown) { return this.management.resetEmployeeCredentials({ ...employeeCredentialsSchema.parse(body), locationId: this.location(actor), actorId: actor.sub, targetId: employeeId }); }

  @Patch("roles/:roleId/permissions") @RequirePermissions(Permission.EmployeePermissionsEdit)
  role(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Body(new ZodValidationPipe(rolePermissionsSchema)) body: unknown) { return this.management.updateRolePermissions({ ...rolePermissionsSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, roleId }); }

  @Get("refunds") @RequirePermissions(Permission.PaymentRefund)
  refundsList(@CurrentActor() actor: RequestActor, @Query("query") query?: string) { return this.refunds.refundable(this.location(actor), query); }

  @Post("refunds/ticket-orders/:orderId") @RequirePermissions(Permission.TicketRefund)
  refundTicket(@CurrentActor() actor: RequestActor, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(refundSchema)) body: unknown) { return this.refunds.refundTicket({ ...refundSchema.parse(body), orderId, locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("refunds/restaurant-tabs/:tabId") @RequirePermissions(Permission.PaymentRefund)
  refundRestaurant(@CurrentActor() actor: RequestActor, @Param("tabId") tabId: string, @Body(new ZodValidationPipe(refundSchema)) body: unknown) { const parsed = refundSchema.parse(body); return this.refunds.refundRestaurant({ requestId: parsed.requestId, reason: parsed.reason, tabId, locationId: this.location(actor), employeeId: actor.sub }); }

  private location(actor: RequestActor) { if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location."); return actor.locationId; }
}
