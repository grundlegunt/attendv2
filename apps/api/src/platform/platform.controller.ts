import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { platformLoginRequestSchema } from "@cinema/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformService } from "./platform.service";

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
}
