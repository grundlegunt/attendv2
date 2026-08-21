import { Body, Controller, Post, Get, Headers, Patch, HttpCode, HttpStatus, Param, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  customerLoginRequestSchema,
  customerPasswordChangeRequestSchema,
  customerPasswordResetConfirmSchema,
  customerPasswordResetRequestSchema,
  customerProfileUpdateRequestSchema,
  customerEmailChangeConfirmSchema,
  customerEmailChangeRequestSchema,
  customerRegisterRequestSchema,
  refreshRequestSchema,
  staffLoginRequestSchema,
  staffPasswordChangeRequestSchema,
  staffMfaConfirmRequestSchema,
  staffMfaVerifyRequestSchema,
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
import { AppError } from "../common/app-error";
import {
  assertTrustedCustomerOrigin,
  clearCustomerSessionCookies,
  requireCustomerRefreshToken,
  setCustomerSessionCookies,
} from "./customer-session";

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
    const result = await this.authService.staffLogin(
      body as ReturnType<typeof staffLoginRequestSchema.parse>,
    );
    const { tokens, employee } = result;
    return { ...toTokenResponse(tokens), employee };
  }

  @Post("staff/mfa/verify")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth" })
  async verifyStaffMfa(@Body(new ZodValidationPipe(staffMfaVerifyRequestSchema)) body: unknown) {
    const { tokens, employee } = await this.authService.verifyStaffMfa(staffMfaVerifyRequestSchema.parse(body));
    return { ...toTokenResponse(tokens), employee };
  }

  @Post("staff/mfa/setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async beginStaffMfaSetup(@CurrentActor() actor: RequestActor) {
    if (actor.actorType !== "EMPLOYEE") throw AppError.forbidden();
    return this.authService.beginStaffMfaSetup(actor.sub);
  }

  @Post("staff/mfa/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async confirmStaffMfa(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(staffMfaConfirmRequestSchema)) body: unknown) {
    if (actor.actorType !== "EMPLOYEE") throw AppError.forbidden();
    const { tokens, employee } = await this.authService.confirmStaffMfa(actor.sub, staffMfaConfirmRequestSchema.parse(body));
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
    if (actor.actorType !== "EMPLOYEE") throw AppError.forbidden();
    await this.authService.staffLogout(actor.sub);
  }

  @Get("staff/me")
  @UseGuards(JwtAuthGuard)
  async staffMe(@CurrentActor() actor: RequestActor) {
    if (actor.actorType !== "EMPLOYEE") throw AppError.forbidden();
    if (actor.supportSession) return this.authService.supportStaffMe(actor);
    return this.authService.staffMe(actor.sub);
  }

  @Post("staff/change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async changeStaffPassword(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(staffPasswordChangeRequestSchema)) body: unknown) {
    if (actor.actorType !== "EMPLOYEE") throw AppError.forbidden();
    const { tokens, employee } = await this.authService.changeStaffPassword(actor.sub, staffPasswordChangeRequestSchema.parse(body));
    return { ...toTokenResponse(tokens), employee };
  }

  // -------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------

  @Post("customers/register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async customerRegister(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(customerRegisterRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    const { tokens, customer } = await this.authService.customerRegister(
      body as ReturnType<typeof customerRegisterRequestSchema.parse>,
    );
    setCustomerSessionCookies(response, tokens);
    return { expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, customer };
  }

  @Post("customers/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async customerLogin(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(customerLoginRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    const { tokens, customer } = await this.authService.customerLogin(
      body as ReturnType<typeof customerLoginRequestSchema.parse>,
    );
    setCustomerSessionCookies(response, tokens);
    return { expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, customer };
  }

  @Post("customers/password-reset/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "email" })
  async requestCustomerPasswordReset(
    @Req() request: Request,
    @Body(new ZodValidationPipe(customerPasswordResetRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    await this.authService.requestCustomerPasswordReset(
      customerPasswordResetRequestSchema.parse(body),
    );
    return { accepted: true };
  }

  @Post("customers/password-reset/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth" })
  async resetCustomerPassword(
    @Req() request: Request,
    @Body(new ZodValidationPipe(customerPasswordResetConfirmSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    await this.authService.resetCustomerPassword(
      customerPasswordResetConfirmSchema.parse(body),
    );
    return { reset: true };
  }

  @Post("customers/refresh")
  @HttpCode(HttpStatus.OK)
  async customerRefresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedCustomerOrigin(request);
    const { tokens, customer } = await this.authService.customerRefresh(requireCustomerRefreshToken(request));
    setCustomerSessionCookies(response, tokens);
    return { expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, customer };
  }

  @Post("customers/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async customerLogout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedCustomerOrigin(request);
    const refreshToken = requireCustomerRefreshToken(request);
    clearCustomerSessionCookies(response);
    await this.authService.customerLogout(refreshToken);
  }

  @Get("customers/me")
  @UseGuards(JwtAuthGuard)
  async customerMe(@CurrentActor() actor: RequestActor) {
    if (actor.actorType !== "CUSTOMER") throw AppError.forbidden();
    return this.authService.customerAccount(actor.sub);
  }

  @Patch("customers/me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async updateCustomerProfile(
    @Req() request: Request,
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(customerProfileUpdateRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    if (actor.actorType !== "CUSTOMER") throw AppError.forbidden();
    return this.authService.updateCustomerProfile(
      actor.sub,
      customerProfileUpdateRequestSchema.parse(body),
      requestId ?? "",
    );
  }

  @Post("customers/email-change/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async requestCustomerEmailChange(
    @Req() request: Request,
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(customerEmailChangeRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    if (actor.actorType !== "CUSTOMER") throw AppError.forbidden();
    await this.authService.requestCustomerEmailChange(
      actor.sub,
      customerEmailChangeRequestSchema.parse(body),
      requestId ?? "",
    );
    return { accepted: true };
  }

  @Post("customers/email-change/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "auth" })
  async confirmCustomerEmailChange(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(customerEmailChangeConfirmSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    await this.authService.confirmCustomerEmailChange(
      customerEmailChangeConfirmSchema.parse(body),
      requestId ?? "",
    );
    clearCustomerSessionCookies(response);
    return { changed: true };
  }

  @Post("customers/orders/:orderId/receipt")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "checkout", identity: "actor" })
  async customerReceipt(
    @Req() request: Request,
    @CurrentActor() actor: RequestActor,
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") requestId: string | undefined,
  ) {
    assertTrustedCustomerOrigin(request);
    if (actor.actorType !== "CUSTOMER") throw AppError.forbidden();
    return this.authService.resendCustomerReceipt(actor.sub, orderId, requestId ?? "");
  }

  @Post("customers/change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RequestRateLimitGuard)
  @RateLimit({ scope: "auth", identity: "actor" })
  async changeCustomerPassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(customerPasswordChangeRequestSchema)) body: unknown,
  ) {
    assertTrustedCustomerOrigin(request);
    if (actor.actorType !== "CUSTOMER") throw AppError.forbidden();
    const { tokens, customer } = await this.authService.changeCustomerPassword(
      actor.sub,
      customerPasswordChangeRequestSchema.parse(body),
      requestId ?? "",
    );
    setCustomerSessionCookies(response, tokens);
    return { expiresInSeconds: loadEnv().JWT_ACCESS_TTL_SECONDS, customer };
  }
}
