import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { adminBrandingSchema, customerBrandingSchema } from "@cinema/shared";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
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
const brandingSchema = customerBrandingSchema.merge(adminBrandingSchema).strict();
const merchSchema = z.object({
  merchUrl: z.string().trim().url().max(2000).refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL.").nullable(),
}).strict();
const siteHeadingSchema = z.object({
  eyebrow: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  intro: z.string().trim().min(1).max(300),
}).strict();
const customerSiteCopySchema = z.object({
  showtimes: siteHeadingSchema,
  comingSoon: siteHeadingSchema,
  filmSeries: siteHeadingSchema,
  dining: siteHeadingSchema,
  about: siteHeadingSchema.extend({
    body: z.array(z.string().trim().min(1).max(2000)).min(1).max(4),
  }).strict(),
}).strict();
const menuPresentationSchema = z.object({
  assetUrl: z.string().trim().url().max(2000).refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL.").nullable(),
  assetType: z.enum(["IMAGE", "PDF"]).nullable(),
}).strict().refine(
  (value) => (value.assetUrl === null) === (value.assetType === null),
  "Provide both a menu asset URL and type, or clear both.",
);
const appliesTo = z.enum(["ALL", "FOOD", "ALCOHOL", "NA_BEVERAGE"]);
const preciseTaxRate = z.number().min(0).max(1000).refine((value) => Number.isInteger(value * 10), "Tax rates support up to two decimal places.");
const taxSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: preciseTaxRate, active: z.boolean().default(true) }).strict();
const taxUpdateSchema = taxSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one tax-rule change.");
const serviceSchema = z.object({ name: z.string().trim().min(1).max(100), appliesTo, ratePermille: z.number().int().min(0).max(1000).optional(), flatCents: z.number().int().min(0).optional(), autoApply: z.boolean().default(true), active: z.boolean().default(true) }).strict();
const serviceUpdateSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), appliesTo: appliesTo.optional(), ratePermille: z.number().int().min(0).max(1000).nullable().optional(), flatCents: z.number().int().min(0).nullable().optional(), autoApply: z.boolean().optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one service-charge change.");
const priceTierSchema = z.object({ name: z.string().trim().min(1).max(100), ticketPriceMinor: z.number().int().min(0).max(1_000_000) }).strict();
const priceTierUpdateSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), ticketPriceMinor: z.number().int().min(0).max(1_000_000).optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one ticket-price change.");
const priceTierBulkUpdateSchema = z.object({ priceTierIds: z.array(z.string().uuid()).min(1).max(50), adjustmentMinor: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Price adjustment cannot be zero.") }).strict();
const ticketTypeSchema = z.object({ name: z.string().trim().min(1).max(100), priceAdjustmentMinor: z.number().int().min(-1_000_000).max(1_000_000).default(0) }).strict();
const ticketTypeUpdateSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), priceAdjustmentMinor: z.number().int().min(-1_000_000).max(1_000_000).optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one ticket-type change.");
const promotionSchema = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1).max(100), type: z.enum(["FIXED_AMOUNT", "PERCENTAGE", "COMP"]), amountCents: z.number().int().positive().optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).optional(), minimumSubtotalCents: z.number().int().min(0).optional(), maximumRedemptions: z.number().int().positive().optional(), active: z.boolean().default(true), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).strict();
const promotionUpdateSchema = z.object({ code: z.string().trim().min(1).max(50).optional(), name: z.string().trim().min(1).max(100).optional(), type: z.enum(["FIXED_AMOUNT", "PERCENTAGE", "COMP"]).optional(), amountCents: z.number().int().positive().nullable().optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(), minimumSubtotalCents: z.number().int().min(0).nullable().optional(), maximumRedemptions: z.number().int().positive().nullable().optional(), active: z.boolean().optional(), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one promotion change.");
const employeeSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email(), password: z.string().min(12).max(200), pin: z.string().regex(/^\d{4,8}$/).optional(), roleIds: z.array(z.string().uuid()).min(1) }).strict();
const employeeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().optional(),
  active: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).min(1).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one employee change.");
const employeeCredentialsSchema = z.object({ password: z.string().min(12).max(200).optional(), pin: z.string().regex(/^\d{4,8}$/).nullable().optional(), resetMfa: z.boolean().optional() }).strict().refine((value) => value.password !== undefined || value.pin !== undefined || value.resetMfa === true, "Provide a password, PIN, or MFA reset.");
const roleSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const inquiryStatusSchema = z.object({ status: z.enum(["NEW", "CONTACTED", "BOOKED", "CLOSED"]) }).strict();
const inquiryQuerySchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "BOOKED", "CLOSED"]).optional(),
  query: z.string().trim().max(200).optional(),
}).strict();
const giftCardSchema = z.object({
  amountCents: z.number().int().min(500).max(100_000),
  recipientName: z.string().trim().min(1).max(120).optional(),
  recipientEmail: z.string().trim().email().max(320).optional(),
}).strict();
const giftCardStatusSchema = z.object({ status: z.enum(["ACTIVE", "DEACTIVATED"]) }).strict();
const rolePermissionsSchema = z.object({ permissionKeys: z.array(z.string()).max(100) }).strict();
const refundSchema = z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(1).max(500), cashDrawerId: z.string().uuid().optional() }).strict();
const refundHistorySchema = z.object({ query: z.string().trim().max(200).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).refine((value) => !value.from || !value.to || value.from < value.to, "Refund-history end date must be after its start date.");
const globalSearchSchema = z.object({ query: z.string().trim().min(2).max(100) }).strict();
const customerHistorySchema = z.object({ ticketOffset: z.coerce.number().int().min(0).max(10_000).default(0), diningOffset: z.coerce.number().int().min(0).max(10_000).default(0), donationOffset: z.coerce.number().int().min(0).max(10_000).default(0) }).strict();
const membershipSchema = z.object({
  membershipNumber: z.string().trim().min(1).max(100),
  planId: z.string().uuid().nullable().optional(),
  tier: z.string().trim().min(1).max(100),
  status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "CANCELED"]),
  expiresAt: z.coerce.date().nullable(),
}).strict();
const membershipDirectorySchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "CANCELED"]).optional(),
  lifecycle: z.enum(["EXPIRING", "LAPSED"]).optional(),
  planId: z.string().uuid().optional(),
}).strict();
const membershipPlanFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  benefitsFairMarketValueCents: z.number().int().min(0).max(1_000_000).default(0),
  durationMonths: z.number().int().min(1).max(120),
  benefits: z.array(z.string().trim().min(1).max(200)).max(25),
  autoRenew: z.boolean().default(false),
  active: z.boolean().default(true),
}).strict();
const membershipPlanSchema = membershipPlanFields.refine((value) => value.benefitsFairMarketValueCents <= value.priceCents, "Benefits' fair-market value cannot exceed the plan price.");
const membershipPlanUpdateSchema = membershipPlanFields.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one plan change.").refine((value) => value.priceCents === undefined || value.benefitsFairMarketValueCents === undefined || value.benefitsFairMarketValueCents <= value.priceCents, "Benefits' fair-market value cannot exceed the plan price.");
const donationCampaignFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  goalAmountCents: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  active: z.boolean().default(true),
}).strict();
const donationCampaignSchema = donationCampaignFields.refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, "Campaign end date must be after its start date.");
const donationCampaignUpdateSchema = donationCampaignFields.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one campaign change.");
const donationSchema = z.object({
  campaignId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  donorName: z.string().trim().max(120).nullable().optional(),
  donorEmail: z.string().trim().email().max(320).nullable().optional(),
  amountCents: z.number().int().positive().max(100_000_000),
  taxDeductibleAmountCents: z.number().int().min(0).max(100_000_000),
  paymentMethod: z.enum(["CASH", "CHECK", "EXTERNAL"]),
  externalReference: z.string().trim().max(200).nullable().optional(),
  receivedAt: z.coerce.date(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict().refine((value) => value.taxDeductibleAmountCents <= value.amountCents, "Tax-deductible amount cannot exceed the donation amount.");
const donationDirectorySchema = z.object({
  campaignId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict().refine((value) => !value.from || !value.to || value.from < value.to, "End date must be after start date.");
const donationCampaignReportSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict().refine((value) => !value.from || !value.to || value.from < value.to, "End date must be after start date.");
const dashboardWidget = z.enum(["metrics", "topFilms", "schedule", "setup", "activity", "quickActions"]);
const dashboardPreferencesSchema = z.object({
  hidden: z.array(dashboardWidget).max(6),
  topOrder: z.array(z.enum(["metrics", "topFilms"])).length(2).refine((value) => new Set(value).size === 2, "Include each overview widget once."),
  mainOrder: z.array(z.enum(["schedule", "activity"])).length(2).refine((value) => new Set(value).size === 2, "Include each main-column widget once."),
  sideOrder: z.array(z.enum(["setup", "quickActions"])).length(2).refine((value) => new Set(value).size === 2, "Include each side-column widget once."),
}).strict();

@Controller("management")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ManagementController {
  constructor(private readonly management: ManagementService, private readonly refunds: ManagementRefundService) {}

  @Get("attention") @RequirePermissions(Permission.PaymentRefund, Permission.ReportsView)
  attentionInbox(@CurrentActor() actor: RequestActor) { return this.management.attentionInbox(this.location(actor)); }

  @Get("search") @RequirePermissions(Permission.PaymentRefund)
  globalSearch(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(globalSearchSchema)) query: unknown) { return this.management.globalSearch(this.location(actor), globalSearchSchema.parse(query).query); }

  @Get("settings") @RequirePermissions(Permission.TicketPriceEdit)
  settings(@CurrentActor() actor: RequestActor) { return this.management.settings(this.location(actor)); }

  @Get("dashboard-preferences")
  dashboardPreferences(@CurrentActor() actor: RequestActor) { return this.management.dashboardPreferences(actor.sub, this.location(actor)); }

  @Patch("dashboard-preferences")
  updateDashboardPreferences(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(dashboardPreferencesSchema)) body: unknown) { return this.management.updateDashboardPreferences({ preferences: dashboardPreferencesSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/location") @RequirePermissions(Permission.TicketPriceEdit)
  updateLocation(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(locationSchema)) body: unknown) { return this.management.updateLocation({ ...locationSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/branding") @RequirePermissions(Permission.TicketPriceEdit)
  updateBranding(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(brandingSchema)) body: unknown) { return this.management.updateBranding({ ...brandingSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/merch") @RequirePermissions(Permission.TicketPriceEdit)
  updateMerch(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(merchSchema)) body: unknown) { return this.management.updateMerch({ ...merchSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/site-copy") @RequirePermissions(Permission.TicketPriceEdit)
  updateSiteCopy(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(customerSiteCopySchema)) body: unknown) { return this.management.updateSiteCopy({ ...customerSiteCopySchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/menu-presentation") @RequirePermissions(Permission.MenuEdit)
  updateMenuPresentation(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(menuPresentationSchema)) body: unknown) { return this.management.updateMenuPresentation({ ...menuPresentationSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Get("settings/menu-presentation") @RequirePermissions(Permission.MenuEdit)
  menuPresentation(@CurrentActor() actor: RequestActor) { return this.management.menuPresentation(this.location(actor)); }

  @Post("settings/price-tiers") @RequirePermissions(Permission.TicketPriceEdit)
  createPriceTier(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(priceTierSchema)) body: unknown) { return this.management.createPriceTier({ ...priceTierSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/price-tiers/bulk") @RequirePermissions(Permission.TicketPriceEdit)
  bulkUpdatePriceTiers(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(priceTierBulkUpdateSchema)) body: unknown) { return this.management.bulkUpdatePriceTiers({ ...priceTierBulkUpdateSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/price-tiers/:priceTierId") @RequirePermissions(Permission.TicketPriceEdit)
  updatePriceTier(@CurrentActor() actor: RequestActor, @Param("priceTierId") priceTierId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(priceTierUpdateSchema)) body: unknown) { return this.management.updatePriceTier({ ...priceTierUpdateSchema.parse(body), priceTierId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Post("settings/ticket-types") @RequirePermissions(Permission.TicketPriceEdit)
  createTicketType(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(ticketTypeSchema)) body: unknown) { return this.management.createTicketType({ ...ticketTypeSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/ticket-types/:ticketTypeId") @RequirePermissions(Permission.TicketPriceEdit)
  updateTicketType(@CurrentActor() actor: RequestActor, @Param("ticketTypeId") ticketTypeId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(ticketTypeUpdateSchema)) body: unknown) { return this.management.updateTicketType({ ...ticketTypeUpdateSchema.parse(body), ticketTypeId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Post("settings/tax-rules") @RequirePermissions(Permission.MenuEdit)
  tax(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(taxSchema)) body: unknown) { return this.management.createTaxRule({ ...taxSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/tax-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  updateTax(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(taxUpdateSchema)) body: unknown) { return this.management.updateTaxRule({ ...taxUpdateSchema.parse(body), ruleId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Delete("settings/tax-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  deleteTax(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Headers("idempotency-key") requestId: string | undefined) { return this.management.deleteTaxRule({ ruleId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Post("settings/service-charge-rules") @RequirePermissions(Permission.MenuEdit)
  service(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(serviceSchema)) body: unknown) { return this.management.createServiceCharge({ ...serviceSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/service-charge-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  updateService(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(serviceUpdateSchema)) body: unknown) { return this.management.updateServiceCharge({ ...serviceUpdateSchema.parse(body), ruleId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Delete("settings/service-charge-rules/:ruleId") @RequirePermissions(Permission.MenuEdit)
  deleteService(@CurrentActor() actor: RequestActor, @Param("ruleId") ruleId: string, @Headers("idempotency-key") requestId: string | undefined) { return this.management.deleteServiceCharge({ ruleId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Post("settings/promotions") @RequirePermissions(Permission.TicketPriceEdit)
  promotion(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(promotionSchema)) body: unknown) { return this.management.createPromotion({ ...promotionSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("settings/promotions/:promotionId") @RequirePermissions(Permission.TicketPriceEdit)
  updatePromotion(@CurrentActor() actor: RequestActor, @Param("promotionId") promotionId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(promotionUpdateSchema)) body: unknown) { return this.management.updatePromotion({ ...promotionUpdateSchema.parse(body), promotionId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Get("people") @RequirePermissions(Permission.EmployeeEdit)
  people(@CurrentActor() actor: RequestActor) { return this.management.people(this.location(actor)); }

  @Get("private-event-inquiries") @RequirePermissions(Permission.ReportsView)
  privateEventInquiries(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(inquiryQuerySchema)) query: unknown) { return this.management.privateEventInquiries(this.location(actor), inquiryQuerySchema.parse(query)); }

  @Get("private-event-inquiries.csv") @RequirePermissions(Permission.ReportsView)
  async privateEventInquiriesCsv(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(inquiryQuerySchema)) query: unknown, @Res() response: Response) {
    const rows = await this.management.privateEventInquiries(this.location(actor), inquiryQuerySchema.parse(query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="private-event-inquiries.csv"');
    response.send(this.management.privateEventInquiriesCsv(rows));
  }

  @Patch("private-event-inquiries/:inquiryId") @RequirePermissions(Permission.ReportsView)
  updatePrivateEventInquiry(@CurrentActor() actor: RequestActor, @Param("inquiryId") inquiryId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(inquiryStatusSchema)) body: unknown) { return this.management.updatePrivateEventInquiry(this.location(actor), actor.sub, inquiryId, inquiryStatusSchema.parse(body).status, requestId ?? randomUUID()); }

  @Get("gift-cards") @RequirePermissions(Permission.PaymentRefund)
  giftCards(@CurrentActor() actor: RequestActor) { return this.management.giftCards(this.location(actor)); }

  @Post("gift-cards") @RequirePermissions(Permission.PaymentRefund)
  issueGiftCard(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(giftCardSchema)) body: unknown) { return this.management.issueGiftCard({ ...giftCardSchema.parse(body), requestId: requestId ?? randomUUID(), locationId: this.location(actor), employeeId: actor.sub }); }

  @Patch("gift-cards/:giftCardId/status") @RequirePermissions(Permission.PaymentRefund)
  updateGiftCardStatus(@CurrentActor() actor: RequestActor, @Param("giftCardId") giftCardId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(giftCardStatusSchema)) body: unknown) { return this.management.updateGiftCardStatus({ ...giftCardStatusSchema.parse(body), giftCardId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Get("customers/:customerId") @RequirePermissions(Permission.PaymentViewDisplaySafe)
  customer(@CurrentActor() actor: RequestActor, @Param("customerId") customerId: string, @Query(new ZodValidationPipe(customerHistorySchema)) query: unknown) { return this.management.customer(this.location(actor), customerId, customerHistorySchema.parse(query)); }

  @Get("memberships") @RequirePermissions(Permission.TicketPriceEdit)
  memberships(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(membershipDirectorySchema)) query: unknown) { return this.management.memberships(this.location(actor), membershipDirectorySchema.parse(query)); }

  @Get("memberships.csv") @RequirePermissions(Permission.TicketPriceEdit)
  async membershipsCsv(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(membershipDirectorySchema)) query: unknown, @Res() response: Response) {
    const rows = await this.management.memberships(this.location(actor), membershipDirectorySchema.parse(query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="memberships.csv"');
    response.send(this.management.membershipsCsv(rows));
  }

  @Get("membership-payments.csv") @RequirePermissions(Permission.TicketPriceEdit)
  async membershipPaymentsCsv(@CurrentActor() actor: RequestActor, @Res() response: Response) {
    const rows = await this.management.membershipPaymentExportRows(this.location(actor));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="membership-payments.csv"');
    response.send(this.management.membershipPaymentsCsv(rows));
  }

  @Get("memberships/summary") @RequirePermissions(Permission.TicketPriceEdit)
  membershipSummary(@CurrentActor() actor: RequestActor) { return this.management.membershipSummary(this.location(actor)); }

  @Get("membership-plans") @RequirePermissions(Permission.TicketPriceEdit)
  membershipPlans(@CurrentActor() actor: RequestActor) { return this.management.membershipPlans(this.location(actor)); }

  @Post("membership-plans") @RequirePermissions(Permission.TicketPriceEdit)
  createMembershipPlan(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(membershipPlanSchema)) body: unknown) { return this.management.createMembershipPlan({ ...membershipPlanSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("membership-plans/:planId") @RequirePermissions(Permission.TicketPriceEdit)
  updateMembershipPlan(@CurrentActor() actor: RequestActor, @Param("planId") planId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(membershipPlanUpdateSchema)) body: unknown) { return this.management.updateMembershipPlan({ ...membershipPlanUpdateSchema.parse(body), planId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Get("customers/:customerId/history.csv") @RequirePermissions(Permission.PaymentViewDisplaySafe)
  async customerHistoryCsv(@CurrentActor() actor: RequestActor, @Param("customerId") customerId: string, @Res() response: Response) {
    const csv = await this.management.customerHistoryCsv(this.location(actor), customerId);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="customer-history.csv"');
    response.send(csv);
  }

  @Patch("customers/:customerId/membership") @RequirePermissions(Permission.TicketPriceEdit)
  updateCustomerMembership(@CurrentActor() actor: RequestActor, @Param("customerId") customerId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(membershipSchema)) body: unknown) {
    return this.management.updateCustomerMembership({ ...membershipSchema.parse(body), customerId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() });
  }

  @Get("donations") @RequirePermissions(Permission.ReportsViewFinancial)
  donations(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(donationDirectorySchema)) query: unknown) { return this.management.donations(this.location(actor), donationDirectorySchema.parse(query)); }

  @Get("donations.csv") @RequirePermissions(Permission.ReportsViewFinancial)
  async donationsCsv(@CurrentActor() actor: RequestActor, @Query(new ZodValidationPipe(donationDirectorySchema)) query: unknown, @Res() response: Response) {
    const rows = await this.management.donationExportRows(this.location(actor), donationDirectorySchema.parse(query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="donations.csv"');
    response.send(this.management.donationsCsv(rows));
  }

  @Get("donation-campaigns/:campaignId") @RequirePermissions(Permission.ReportsViewFinancial)
  donationCampaign(@CurrentActor() actor: RequestActor, @Param("campaignId") campaignId: string, @Query(new ZodValidationPipe(donationCampaignReportSchema)) query: unknown) {
    return this.management.donationCampaign(this.location(actor), z.string().uuid().parse(campaignId), donationCampaignReportSchema.parse(query));
  }

  @Post("donations") @RequirePermissions(Permission.ReportsViewFinancial)
  recordDonation(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(donationSchema)) body: unknown) { return this.management.recordDonation({ ...donationSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Post("donation-campaigns") @RequirePermissions(Permission.TicketPriceEdit)
  createDonationCampaign(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(donationCampaignSchema)) body: unknown) { return this.management.createDonationCampaign({ ...donationCampaignSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("donation-campaigns/:campaignId") @RequirePermissions(Permission.TicketPriceEdit)
  updateDonationCampaign(@CurrentActor() actor: RequestActor, @Param("campaignId") campaignId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(donationCampaignUpdateSchema)) body: unknown) { return this.management.updateDonationCampaign({ ...donationCampaignUpdateSchema.parse(body), campaignId, locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Get("payment-methods/:paymentMethodId") @RequirePermissions(Permission.PaymentViewDisplaySafe)
  paymentMethod(@CurrentActor() actor: RequestActor, @Param("paymentMethodId") paymentMethodId: string) { return this.management.paymentMethod(this.location(actor), paymentMethodId); }

  @Post("employees") @RequirePermissions(Permission.EmployeeCreate)
  employee(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(employeeSchema)) body: unknown) { return this.management.createEmployee({ ...employeeSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("employees/:employeeId") @RequirePermissions(Permission.EmployeeEdit)
  updateEmployee(@CurrentActor() actor: RequestActor, @Param("employeeId") employeeId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(employeeUpdateSchema)) body: unknown) { return this.management.updateEmployee({ ...employeeUpdateSchema.parse(body), locationId: this.location(actor), actorId: actor.sub, targetId: employeeId, requestId: requestId ?? randomUUID() }); }

  @Patch("employees/:employeeId/credentials") @RequirePermissions(Permission.EmployeeEdit)
  resetEmployeeCredentials(@CurrentActor() actor: RequestActor, @Param("employeeId") employeeId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(employeeCredentialsSchema)) body: unknown) { return this.management.resetEmployeeCredentials({ ...employeeCredentialsSchema.parse(body), locationId: this.location(actor), actorId: actor.sub, targetId: employeeId, requestId: requestId ?? randomUUID() }); }

  @Post("roles") @RequirePermissions(Permission.EmployeePermissionsEdit)
  createRole(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(roleSchema)) body: unknown) { return this.management.createRole({ ...roleSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, requestId: requestId ?? randomUUID() }); }

  @Patch("roles/:roleId") @RequirePermissions(Permission.EmployeePermissionsEdit)
  updateRole(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(roleSchema)) body: unknown) { return this.management.updateRole({ ...roleSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, roleId, requestId: requestId ?? randomUUID() }); }

  @Delete("roles/:roleId") @RequirePermissions(Permission.EmployeePermissionsEdit)
  deleteRole(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Headers("idempotency-key") requestId: string | undefined) { return this.management.deleteRole({ locationId: this.location(actor), employeeId: actor.sub, roleId, requestId: requestId ?? randomUUID() }); }

  @Patch("roles/:roleId/permissions") @RequirePermissions(Permission.EmployeePermissionsEdit)
  role(@CurrentActor() actor: RequestActor, @Param("roleId") roleId: string, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(rolePermissionsSchema)) body: unknown) { return this.management.updateRolePermissions({ ...rolePermissionsSchema.parse(body), locationId: this.location(actor), employeeId: actor.sub, roleId, requestId: requestId ?? randomUUID() }); }

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
