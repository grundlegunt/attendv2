import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { adminBrandingSchema, customerBrandingSchema, platformLoginRequestSchema } from "@cinema/shared";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformService } from "./platform.service";

const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  legalName: z.string().trim().min(1).max(200).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  onboardingStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "RESTRICTED"]).optional(),
}).strict();

const locationUpdateSchema = z.object({
  address: z.string().trim().min(1).max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
  ticketTaxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  preShowBufferMinutes: z.number().int().min(0).max(240).optional(),
  cleaningBufferMinutes: z.number().int().min(0).max(240).optional(),
  checkDropMinutesBeforeEnd: z.number().int().min(0).max(240).optional(),
  autoSettleGraceMinutes: z.number().int().min(0).max(240).optional(),
  timeClockEnabled: z.boolean().optional(),
}).merge(customerBrandingSchema).merge(adminBrandingSchema).strict();

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

  @Patch("organizations/:organizationId/locations/:locationId")
  @UseGuards(PlatformAuthGuard)
  updateLocation(@CurrentActor() actor: RequestActor, @Param("organizationId") organizationId: string, @Param("locationId") locationId: string, @Body(new ZodValidationPipe(locationUpdateSchema)) body: unknown) {
    return this.platform.updateLocation({ actorId: actor.sub, organizationId, locationId, ...locationUpdateSchema.parse(body) });
  }
}
