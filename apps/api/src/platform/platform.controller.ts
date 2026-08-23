import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { adminBrandingSchema, adminUiConfigSchema, cinemaContentSchema, createAuditoriumRequestSchema, customerBrandingSchema, platformLoginRequestSchema, updateAuditoriumLayoutRequestSchema } from "@cinema/shared";
import { z } from "zod";
import type { Response } from "express";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AppError } from "../common/app-error";
import { isPlatformOriginAllowed } from "../common/cors-origin";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformService } from "./platform.service";
import { PlatformPermissionGuard } from "./platform-permission.guard";
import { PLATFORM_TEAM_PERMISSION, PLATFORM_WRITE_PERMISSION, RequirePlatformPermission } from "./platform-permissions";

const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  legalName: z.string().trim().min(1).max(200).nullable().optional(),
  businessTypeLabel: z.string().trim().min(1).max(80).nullable().optional(),
  defaultSeatingMode: z.enum(["RESERVED", "GENERAL_ADMISSION"]).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  ticketFeeMinor: z.number().int().min(0).max(100_000).optional(),
  active: z.boolean().optional(),
}).strict();

const connectOnboardingSchema = z.object({
  origin: z.string().url(),
  returnPath: z.enum(["/clients", "/payments"]).default("/clients"),
}).strict();

const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(200).nullable().optional(),
  businessTypeLabel: z.string().trim().min(1).max(80).nullable().optional(),
  defaultSeatingMode: z.enum(["RESERVED", "GENERAL_ADMISSION"]).optional(),
  timezone: z.string().trim().min(1).max(100),
  location: z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    timezone: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

const locationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
  ticketTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  preShowBufferMinutes: z.number().int().min(0).max(240).optional(),
  cleaningBufferMinutes: z.number().int().min(0).max(240).optional(),
  checkDropMinutesBeforeEnd: z.number().int().min(0).max(240).optional(),
  autoSettleGraceMinutes: z.number().int().min(0).max(240).optional(),
  timeClockEnabled: z.boolean().optional(),
  adminUi: adminUiConfigSchema.optional(),
}).merge(customerBrandingSchema).merge(adminBrandingSchema).strict();

const brandingDraftSchema = customerBrandingSchema.omit({ name: true })
  .merge(adminBrandingSchema)
  .extend({ adminUi: adminUiConfigSchema })
  .strict();

const cinemaManagerCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
}).strict();

const auditoriumDuplicateSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

const platformUserCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
  role: z.enum(["OWNER", "OPERATOR", "VIEWER"]).default("OPERATOR"),
}).strict();

const platformUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  role: z.enum(["OWNER", "OPERATOR", "VIEWER"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one team field is required.");

const platformUserCredentialsSchema = z.object({
  password: z.string().min(12).max(200),
}).strict();

const platformRefreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();

@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async login(@Body(new ZodValidationPipe(platformLoginRequestSchema)) body: unknown) {
    const { tokens, user } = await this.platform.login(platformLoginRequestSchema.parse(body));
    return { ...tokens, expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, user };
  }

  @Post("auth/refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth" })
  async refresh(@Body(new ZodValidationPipe(platformRefreshSchema)) body: unknown) {
    const { tokens, user } = await this.platform.refreshSession(platformRefreshSchema.parse(body).refreshToken);
    return { ...tokens, expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, user };
  }

  @Post("auth/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PlatformAuthGuard)
  async logout(@CurrentActor() actor: RequestActor) {
    await this.platform.logout(actor.sub);
  }

  @Get("overview")
  @UseGuards(PlatformAuthGuard)
  overview() {
    return this.platform.overview();
  }

  @Get("revenue")
  @UseGuards(PlatformAuthGuard)
  revenue(@Query("from") from?: string, @Query("to") to?: string, @Query("organizationId") organizationId?: string) {
    return this.platform.revenue({ from, to, organizationId });
  }

  @Get("revenue.csv")
  @UseGuards(PlatformAuthGuard)
  async revenueCsv(@Res() response: Response, @Query("from") from?: string, @Query("to") to?: string, @Query("organizationId") organizationId?: string) {
    const report = await this.platform.revenue({ from, to, organizationId });
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-master-revenue.csv"');
    response.send(this.platform.revenueCsv(report));
  }

  @Get("audit-events")
  @UseGuards(PlatformAuthGuard)
  auditEvents(@Query("limit") limit?: string, @Query("offset") offset?: string, @Query("organizationId") organizationId?: string, @Query("action") action?: string, @Query("actorId") actorId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.platform.auditEvents({ limit, offset, organizationId, action, actorId, from, to });
  }

  @Get("team")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_TEAM_PERMISSION)
  team() {
    return this.platform.team();
  }

  @Post("team")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_TEAM_PERMISSION)
  createPlatformUser(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(platformUserCreateSchema)) body: unknown) {
    return this.platform.createPlatformUser({ actorId: actor.sub, ...platformUserCreateSchema.parse(body) });
  }

  @Patch("team/:userId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_TEAM_PERMISSION)
  updatePlatformUser(@CurrentActor() actor: RequestActor, @Param("userId") userId: string, @Body(new ZodValidationPipe(platformUserUpdateSchema)) body: unknown) {
    return this.platform.updatePlatformUser({ actorId: actor.sub, userId, ...platformUserUpdateSchema.parse(body) });
  }

  @Patch("team/:userId/credentials")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_TEAM_PERMISSION)
  resetPlatformUserCredentials(@CurrentActor() actor: RequestActor, @Param("userId") userId: string, @Body(new ZodValidationPipe(platformUserCredentialsSchema)) body: unknown) {
    return this.platform.resetPlatformUserCredentials({ actorId: actor.sub, userId, ...platformUserCredentialsSchema.parse(body) });
  }

  @Post("organizations")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  createOrganization(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(organizationCreateSchema)) body: unknown) {
    return this.platform.createOrganization({ actorId: actor.sub, ...organizationCreateSchema.parse(body) });
  }

  @Get("organizations/:organizationId")
  @UseGuards(PlatformAuthGuard)
  organization(@Param("organizationId") organizationId: string) {
    return this.platform.organization(organizationId);
  }

  @Patch("organizations/:organizationId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  updateOrganization(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(organizationUpdateSchema)) body: unknown) {
    return this.platform.updateOrganization({ actorId: actor.sub, organizationId, ...organizationUpdateSchema.parse(body) });
  }

  @Delete("organizations/:organizationId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  deleteOrganization(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string) {
    return this.platform.deleteOrganization({ actorId: actor.sub, organizationId });
  }

  @Post("organizations/:organizationId/connect/onboarding-link")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  connectOnboardingLink(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(connectOnboardingSchema)) body: unknown) {
    const { origin, returnPath } = connectOnboardingSchema.parse(body);
    if (new URL(origin).origin !== origin || !isPlatformOriginAllowed(origin)) {
      throw AppError.validationFailed("Stripe onboarding must return to an allowed Attend Master origin.");
    }
    return this.platform.createConnectOnboardingLink({ actorId: actor.sub, organizationId, origin, returnPath });
  }

  @Post("organizations/:organizationId/connect/refresh")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  refreshConnectStatus(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string) {
    return this.platform.refreshConnectStatus({ actorId: actor.sub, organizationId });
  }

  @Patch("organizations/:organizationId/locations/:locationId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  updateLocation(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(locationUpdateSchema)) body: unknown) {
    return this.platform.updateLocation({ actorId: actor.sub, organizationId, locationId, ...locationUpdateSchema.parse(body) });
  }

  @Post("organizations/:organizationId/locations/:locationId/auditoriums")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  createAuditorium(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(createAuditoriumRequestSchema)) body: unknown) {
    return this.platform.createAuditorium({ actorId: actor.sub, organizationId, locationId, ...createAuditoriumRequestSchema.parse(body) });
  }

  @Patch("organizations/:organizationId/locations/:locationId/auditoriums/:auditoriumId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  updateAuditorium(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Param("auditoriumId") auditoriumId: string, @Body(new ZodValidationPipe(updateAuditoriumLayoutRequestSchema)) body: unknown) {
    return this.platform.updateAuditorium({ actorId: actor.sub, organizationId, locationId, auditoriumId, ...updateAuditoriumLayoutRequestSchema.parse(body) });
  }

  @Delete("organizations/:organizationId/locations/:locationId/auditoriums/:auditoriumId")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  deleteAuditorium(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Param("auditoriumId") auditoriumId: string) {
    return this.platform.deleteAuditorium({ actorId: actor.sub, organizationId, locationId, auditoriumId });
  }

  @Post("organizations/:organizationId/locations/:locationId/auditoriums/:auditoriumId/duplicate")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  duplicateAuditorium(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Param("auditoriumId") auditoriumId: string, @Body(new ZodValidationPipe(auditoriumDuplicateSchema)) body: unknown) {
    return this.platform.duplicateAuditorium({ actorId: actor.sub, organizationId, locationId, auditoriumId, ...auditoriumDuplicateSchema.parse(body) });
  }

  @Patch("organizations/:organizationId/locations/:locationId/auditoriums/:auditoriumId/deactivate")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  deactivateAuditorium(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Param("auditoriumId") auditoriumId: string) {
    return this.platform.deactivateAuditorium({ actorId: actor.sub, organizationId, locationId, auditoriumId });
  }

  @Patch("organizations/:organizationId/locations/:locationId/branding/draft")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  updateBrandingDraft(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(brandingDraftSchema)) body: unknown) {
    return this.platform.updateBrandingDraft({ actorId: actor.sub, organizationId, locationId, branding: brandingDraftSchema.parse(body) });
  }

  @Post("organizations/:organizationId/locations/:locationId/branding/publish")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  publishBranding(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string) {
    return this.platform.publishBranding({ actorId: actor.sub, organizationId, locationId });
  }

  @Post("organizations/:organizationId/locations/:locationId/support-session")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  createSupportSession(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string) {
    return this.platform.createSupportSession({ actorId: actor.sub, organizationId, locationId });
  }

  @Post("organizations/:organizationId/locations/:locationId/cinema-manager")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  createCinemaManager(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(cinemaManagerCreateSchema)) body: unknown) {
    return this.platform.createCinemaManager({ actorId: actor.sub, organizationId, locationId, ...cinemaManagerCreateSchema.parse(body) });
  }

  @Patch("organizations/:organizationId/locations/:locationId/content/draft")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  updateContentDraft(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(cinemaContentSchema)) body: unknown) {
    return this.platform.updateContentDraft({ actorId: actor.sub, organizationId, locationId, content: cinemaContentSchema.parse(body) });
  }

  @Post("organizations/:organizationId/locations/:locationId/content/publish")
  @UseGuards(PlatformAuthGuard, PlatformPermissionGuard)
  @RequirePlatformPermission(PLATFORM_WRITE_PERMISSION)
  publishContent(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string) {
    return this.platform.publishContent({ actorId: actor.sub, organizationId, locationId });
  }
}
