import { Body, Controller, Post, Get, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import {
  customerLoginRequestSchema,
  customerRegisterRequestSchema,
  refreshRequestSchema,
  staffLoginRequestSchema,
  AuthTokenResponse,
} from "@cinema/shared";
import { loadEnv } from "@cinema/config/env";
import { AuthService } from "./auth.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentActor } from "./decorators/current-actor.decorator";
import { RequestActor } from "./types";
import { TokenPair } from "@cinema/auth";
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";

function toTokenResponse(tokens: TokenPair): AuthTokenResponse {
  const env = loadEnv();
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
  };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // -------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------

  @Post("staff/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async staffLogin(@Body(new ZodValidationPipe(staffLoginRequestSchema)) body: unknown) {
    const { tokens, employee } = await this.authService.staffLogin(
      body as ReturnType<typeof staffLoginRequestSchema.parse>,
    );
    return { ...toTokenResponse(tokens), employee };
  }

  @Post("staff/refresh")
  @HttpCode(HttpStatus.OK)
  async staffRefresh(@Body(new ZodValidationPipe(refreshRequestSchema)) body: { refreshToken: string }) {
    const { tokens, employee } = await this.authService.staffRefresh(body.refreshToken);
    return { ...toTokenResponse(tokens), employee };
  }

  @Post("staff/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async staffLogout(@CurrentActor() actor: RequestActor) {
    await this.authService.staffLogout(actor.sub);
  }

  @Get("staff/me")
  @UseGuards(JwtAuthGuard)
  async staffMe(@CurrentActor() actor: RequestActor) {
    return this.authService.staffMe(actor.sub);
  }

  // -------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------

  @Post("customers/register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async customerRegister(@Body(new ZodValidationPipe(customerRegisterRequestSchema)) body: unknown) {
    const { tokens, customer } = await this.authService.customerRegister(
      body as ReturnType<typeof customerRegisterRequestSchema.parse>,
    );
    return { ...toTokenResponse(tokens), customer };
  }

  @Post("customers/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async customerLogin(@Body(new ZodValidationPipe(customerLoginRequestSchema)) body: unknown) {
    const { tokens, customer } = await this.authService.customerLogin(
      body as ReturnType<typeof customerLoginRequestSchema.parse>,
    );
    return { ...toTokenResponse(tokens), customer };
  }

  @Post("customers/refresh")
  @HttpCode(HttpStatus.OK)
  async customerRefresh(@Body(new ZodValidationPipe(refreshRequestSchema)) body: { refreshToken: string }) {
    const { tokens, customer } = await this.authService.customerRefresh(body.refreshToken);
    return { ...toTokenResponse(tokens), customer };
  }

  @Post("customers/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async customerLogout(@CurrentActor() actor: RequestActor) {
    await this.authService.customerLogout(actor.sub);
  }
}
