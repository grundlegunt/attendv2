import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
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

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  timeClockEnabled: z.boolean().optional(),
  ticketTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  preShowBufferMinutes: z.number().int().min(0).max(240).optional(),
  cleaningBufferMinutes: z.number().int().min(15).max(240).optional(),
  checkDropMinutesBeforeEnd: z.number().int().min(0).max(240).optional(),
  autoSettleGraceMinutes: z.number().int().min(0).max(240).optional(),
  autoSettleTipBasisPoints: z.number().int().min(0).max(10_000).optional(),
}).strict();
const appliesTo = z.enum(["ALL", "FOOD", "ALCOHOL", "NA_BEVERAGE"]);
const taxSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: z.number().int().min(0).max(1000), active: z.boolean().default(true) }).strict();
const taxUpdateSchema = taxSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one tax-rule change.");
const serviceSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: z.number().int().min(0).max(1000).optional(), flatCents: z.number().int().min(0).optional(), autoApply: z.boolean().default(true), active: z.boolean().default(true) }).strict();
const serviceUpdateSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), appliesTo: appliesTo.optional(), ratePermille: z.number().int().min(0).max(1000).nullable().optional(), flatCents: z.number().int().min(0).nullable().optional(), autoApply: z.boolean().optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one service-charge change.");
const promotionSchema = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1).max(100), type: z.enum(["FIXED_AMOUNT", "PERCENTAGE", "COMP"]), amountCents: z.number().int().positive().optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).optional(), minimumSubtotalCents: z.number().int().min(0).optional(), maximumRedemptions: z.number().int().positive().optional(), active: z.boolean().default(true), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).strict();
const promotionUpdateSchema = z.object({ code: z.string().trim().min(1).max(50).optional(), name: z.string().trim().min(1).max(100).optional(), type: z.enum(["FIXED_AMOUNT", "PERCENTAGE", "COMP"]).optional(), amountCents: z.number().int().positive().nullable().optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(), minimumSubtotalCents: z.number().int().min(0).nullable().optional(), maximumRedemptions: z.number().int().positive().nullable().optional(), active: z.boolean().optional(), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one promotion change.");
const employeeSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email(), password: z.string().min(12).max(200), pin: z.string().regex(/^\d{4,8}$/).optional(), roleIds: z.array(z.string().uuid()).min(1) }).strict();
const employeeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().optional(),
  active: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).min(1).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one employee change.");
const employeeCredentialsSchema = z.object({ password: z.string().min(12).max(200).optional(), pin: z.string().regex(/^\d{4,8}$/).nullable().optional() }).strict().refine((value) => value.password !== undefined || value.pin !== undefined, "Provide a password or PIN reset.");
const roleSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const rolePermissionsSchema = z.object({ permissionKeys: z.array(z.string()).max(100) }).strict();
const refundSchema = z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(1).max(500), cashDrawerId: z.string().uuid().optional() }).strict();
const refundHistorySchema = z.object({ query: z.string().trim().max(200).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).refine((value) => !value.from || !value.to || value.from < value.to, "Refund-history end date must be after its start date.");

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

  @Patch("settings/tax-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  updateTax(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Body(new ZodValidationPipe(taxUpdateSchema)) body: unknown) { return this.management.updateTaxRule({ ...taxUpdateSchema.parse(body), ruleId, locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("settings/service-charge-rules") @RequirePermissions(Permission.MenuEdit)
  service(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(serviceSchema)) body: unknown) { return this.management.createServiceCharge({ ...serviceSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Patch("settings/service-charge-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  updateService(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Body(new ZodValidationPipe(serviceUpdateSchema)) body: unknown) { return this.management.updateServiceCharge({ ...serviceUpdateSchema.parse(body), ruleId, locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("settings/promotions") @RequirePermissions(Permission.TicketPriceEdit)
  promotion(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(promotionSchema)) body: unknown) { return this.management.createPromotion({ ...promotionSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Patch("settings/promotions/:promotionId") @RequirePermissions(Permission.TicketPriceEdit)
  updatePromotion(@CurrentActor() actor: RequestActor, @Param("promotionId") promotionId: string, @Body(new ZodValidationPipe(promotionUpdateSchema)) body: unknown) { return this.management.updatePromotion({ ...promotionUpdateSchema.parse(body), promotionId, locationId: this.location(actor), employeeId: actor.sub }); }

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

  @Post("roles") @RequirePermissions(Permission.EmployeePermissionsEdit)
  createRole(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(roleSchema)) body: unknown) { return this.management.createRole({ ...roleSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub }); }

  @Patch("roles/:roleId") @RequirePermissions(Permission.EmployeePermissionsEdit)
  updateRole(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Body(new ZodValidationPipe(roleSchema)) body: unknown) { return this.management.updateRole({ ...roleSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, roleId }); }

  @Delete("roles/:roleId") @RequirePermissions(Permission.EmployeePermissionsEdit)
  deleteRole(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string) { return this.management.deleteRole({ locationId: this.location(actor), employeeId: actor.sub, roleId }); }

  @Patch("roles/:roleId/permissions") @RequirePermissions(Permission.EmployeePermissionsEdit)
  role(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Body(new ZodValidationPipe(rolePermissionsSchema)) body: unknown) { return this.management.updateRolePermissions({ ...rolePermissionsSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, roleId }); }

  @Get("refunds") @RequirePermissions(Permission.PaymentRefund)
  refundsList(@CurrentActor() actor: RequestActor, @Query("query") query?: string) { return this.refunds.refundable(this.location(actor), query); }

  @Get("refunds/history") @RequirePermissions(Permission.PaymentRefund)
  refundsHistory(@CurrentActor() actor: RequestActor, @Query() query: unknown) { return this.refunds.history(this.location(actor), refundHistorySchema.parse(query)); }

  @Post("refunds/ticket-orders/:orderId") @RequirePermissions(Permission.TicketRefund)
  refundTicket(@CurrentActor() actor: RequestActor, @Param("orderId") orderId: string, @Body(new ZodValidationPipe(refundSchema)) body: unknown) { return this.refunds.refundTicket({ ...refundSchema.parse(body), orderId, locationId: this.location(actor), employeeId: actor.sub }); }

  @Post("refunds/restaurant-tabs/:tabId") @RequirePermissions(Permission.PaymentRefund)
  refundRestaurant(@CurrentActor() actor: RequestActor, @Param("tabId") tabId: string, @Body(new ZodValidationPipe(refundSchema)) body: unknown) { const parsed = refundSchema.parse(body); return this.refunds.refundRestaurant({ requestId: parsed.requestId, reason: parsed.reason, tabId, locationId: this.location(actor), employeeId: actor.sub }); }

  private location(actor: RequestActor) { if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location."); return actor.locationId; }
}
