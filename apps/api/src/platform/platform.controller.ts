import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { adminBrandingSchema, adminUiConfigSchema, cinemaContentSchema, customerBrandingSchema, platformLoginRequestSchema } from "@cinema/shared";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AppError } from "../common/app-error";
import { isPlatformOriginAllowed } from "../common/cors-origin";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformService } from "./platform.service";

const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  legalName: z.string().trim().min(1).max(200).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  ticketFeeMinor: z.number().int().min(0).max(100_000).optional(),
}).strict();

const connectOnboardingSchema = z.object({
  origin: z.string().url(),
  returnPath: z.enum(["/clients", "/payments"]).default("/clients"),
}).strict();

const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(200).nullable().optional(),
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

const cinemaManagerCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
}).strict();

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

  @Get("overview")
  @UseGuards(PlatformAuthGuard)
  overview() {
    return this.platform.overview();
  }

  @Get("audit-events")
  @UseGuards(PlatformAuthGuard)
  auditEvents(@Query("limit") limit?: string, @Query("offset") offset?: string, @Query("organizationId") organizationId?: string, @Query("action") action?: string, @Query("actorId") actorId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.platform.auditEvents({ limit, offset, organizationId, action, actorId, from, to });
  }

  @Post("organizations")
  @UseGuards(PlatformAuthGuard)
  createOrganization(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(organizationCreateSchema)) body: unknown) {
    return this.platform.createOrganization({ actorId: actor.sub, ...organizationCreateSchema.parse(body) });
  }

  @Get("organizations/:organizationId")
  @UseGuards(PlatformAuthGuard)
  organization(@Param("organizationId") organizationId: string) {
    return this.platform.organization(organizationId);
  }

  @Patch("organizations/:organizationId")
  @UseGuards(PlatformAuthGuard)
  updateOrganization(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(organizationUpdateSchema)) body: unknown) {
    return this.platform.updateOrganization({ actorId: actor.sub, organizationId, ...organizationUpdateSchema.parse(body) });
  }

  @Post("organizations/:organizationId/connect/onboarding-link")
  @UseGuards(PlatformAuthGuard)
  connectOnboardingLink(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(connectOnboardingSchema)) body: unknown) {
    const { origin, returnPath } = connectOnboardingSchema.parse(body);
    if (new URL(origin).origin !== origin || !isPlatformOriginAllowed(origin)) {
      throw AppError.validationFailed("Stripe onboarding must return to an allowed Attend Master origin.");
    }
    return this.platform.createConnectOnboardingLink({ actorId: actor.sub, organizationId, origin, returnPath });
  }

  @Post("organizations/:organizationId/connect/refresh")
  @UseGuards(PlatformAuthGuard)
  refreshConnectStatus(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string) {
    return this.platform.refreshConnectStatus({ actorId: actor.sub, organizationId });
  }

  @Patch("organizations/:organizationId/locations/:locationId")
  @UseGuards(PlatformAuthGuard)
  updateLocation(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(locationUpdateSchema)) body: unknown) {
    return this.platform.updateLocation({ actorId: actor.sub, organizationId, locationId, ...locationUpdateSchema.parse(body) });
  }

  @Post("organizations/:organizationId/locations/:locationId/cinema-manager")
  @UseGuards(PlatformAuthGuard)
  createCinemaManager(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(cinemaManagerCreateSchema)) body: unknown) {
    return this.platform.createCinemaManager({ actorId: actor.sub, organizationId, locationId, ...cinemaManagerCreateSchema.parse(body) });
  }

  @Patch("organizations/:organizationId/locations/:locationId/content/draft")
  @UseGuards(PlatformAuthGuard)
  updateContentDraft(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(cinemaContentSchema)) body: unknown) {
    return this.platform.updateContentDraft({ actorId: actor.sub, organizationId, locationId, content: cinemaContentSchema.parse(body) });
  }

  @Post("organizations/:organizationId/locations/:locationId/content/publish")
  @UseGuards(PlatformAuthGuard)
  publishContent(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string) {
    return this.platform.publishContent({ actorId: actor.sub, organizationId, locationId });
  }
}
