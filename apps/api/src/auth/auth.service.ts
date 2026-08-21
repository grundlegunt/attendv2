import { Inject, Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@cinema/database";
import {
  hashPassword,
  verifyPassword,
  signTokenPair,
  verifyRefreshToken,
  signCustomerPasswordResetToken,
  verifyCustomerPasswordResetToken,
  signCustomerEmailChangeToken,
  verifyCustomerEmailChangeToken,
  InvalidTokenError,
  TokenPair,
  createMfaSecret,
  createMfaUri,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyMfaChallenge,
  verifyMfaCode,
  Permission,
} from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import {
  AuthenticatedCustomer,
  CustomerAccountResponse,
  AuthenticatedEmployee,
  CustomerLoginRequest,
  CustomerPasswordChangeRequest,
  CustomerPasswordResetConfirm,
  CustomerPasswordResetRequest,
  CustomerRegisterRequest,
  CustomerProfileUpdateRequest,
  CustomerEmailChangeConfirm,
  CustomerEmailChangeRequest,
  StaffLoginRequest,
  StaffPasswordChangeRequest,
  StaffMfaConfirmRequest,
  StaffMfaVerifyRequest,
} from "@cinema/shared";
import type { RequestActor } from "./types";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";
import { EmailProvider, TicketReceipt } from "@cinema/notifications";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";

const employeeInclude = {
  authAccount: true,
  location: { include: { organization: { select: { active: true } } } },
  employeeRoles: {
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  },
} as const;

type EmployeeWithRoles = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

function flattenEmployeePermissions(employee: EmployeeWithRoles): string[] {
  const set = new Set<string>();
  for (const er of employee.employeeRoles) {
    for (const rp of er.role.rolePermissions) {
      set.add(rp.permission.key);
    }
  }
  return [...set];
}

function employeeToProfile(employee: EmployeeWithRoles): AuthenticatedEmployee {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    locationId: employee.locationId,
    roles: employee.employeeRoles.map((er) => er.role.key),
    permissions: employee.authAccount?.mustChangePassword ? [] : flattenEmployeePermissions(employee),
    timeClockEnabled: employee.location.timeClockEnabled,
    mustChangePassword: employee.authAccount?.mustChangePassword ?? false,
    mfaEnabled: false,
    mfaSetupRequired: false,
    adminBranding: {
      accentColor: employee.location.adminAccentColor,
      accentMutedColor: employee.location.adminAccentMutedColor,
      backgroundColor: employee.location.adminBackgroundColor,
      surfaceColor: employee.location.adminSurfaceColor,
      textColor: employee.location.adminTextColor,
      mutedTextColor: employee.location.adminMutedTextColor,
    },
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------

  async staffLogin(input: StaffLoginRequest): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    const employee = await prisma.employee.findUnique({
      where: { email: input.email.toLowerCase() },
      include: employeeInclude,
    });

    if (!employee || !employee.active || !employee.location.organization.active || !employee.authAccount) {
      throw AppError.invalidCredentials();
    }

    const passwordOk = await verifyPassword(employee.authAccount.passwordHash, input.password);
    if (!passwordOk) {
      throw AppError.invalidCredentials();
    }

    const tokens = this.issueEmployeeTokens(employee);

    await this.audit.record({
      actorType: "EMPLOYEE",
      actorId: employee.id,
      action: "employee.login",
      entityType: "Employee",
      entityId: employee.id,
      locationId: employee.locationId,
    });

    return { tokens, employee: employeeToProfile(employee) };
  }

  async supportStaffMe(actor: RequestActor): Promise<AuthenticatedEmployee & { supportSession: true }> {
    if (!actor.locationId) throw AppError.unauthenticated("Support session is missing its location.");
    const [operator, location] = await Promise.all([
      prisma.platformUser.findUnique({ where: { id: actor.sub } }),
      prisma.location.findUnique({ where: { id: actor.locationId } }),
    ]);
    if (!operator?.active || !location) throw AppError.unauthenticated("Support session is no longer valid.");
    return {
      id: operator.id,
      name: `${operator.name} (Attend Support)`,
      email: operator.email,
      locationId: location.id,
      roles: [],
      permissions: Object.values(Permission),
      timeClockEnabled: false,
      mustChangePassword: false,
      mfaEnabled: false,
      mfaSetupRequired: false,
      adminBranding: {
        accentColor: location.adminAccentColor,
        accentMutedColor: location.adminAccentMutedColor,
        backgroundColor: location.adminBackgroundColor,
        surfaceColor: location.adminSurfaceColor,
        textColor: location.adminTextColor,
        mutedTextColor: location.adminMutedTextColor,
      },
      supportSession: true,
    };
  }

  async verifyStaffMfa(input: StaffMfaVerifyRequest): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    let employeeId: string;
    try {
      employeeId = verifyMfaChallenge(input.challengeToken, loadEnv().JWT_ACCESS_SECRET);
    } catch {
      throw AppError.unauthenticated("The MFA challenge expired. Sign in again.");
    }
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
    if (!employee?.active || !employee.location.organization.active || !employee.authAccount?.mfaEnabled || !employee.authAccount.mfaSecretEncrypted) throw AppError.unauthenticated();
    const secret = decryptMfaSecret(employee.authAccount.mfaSecretEncrypted, loadEnv().JWT_REFRESH_SECRET);
    if (!(await verifyMfaCode(secret, input.code))) throw AppError.invalidCredentials("The authenticator code is incorrect.");
    await this.audit.record({ actorType: "EMPLOYEE", actorId: employee.id, action: "employee.mfa_verified", entityType: "Employee", entityId: employee.id, locationId: employee.locationId });
    return { tokens: this.issueEmployeeTokens(employee), employee: employeeToProfile(employee) };
  }

  async beginStaffMfaSetup(employeeId: string): Promise<{ secret: string; uri: string }> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "employeeId" FROM "staff_auth_accounts" WHERE "employeeId" = ${employeeId} FOR UPDATE`;
      const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
      if (!employee?.active || !employee.authAccount) throw AppError.unauthenticated();
      if (employee.authAccount.mustChangePassword) throw AppError.forbidden("Change your temporary password before setting up MFA.");
      if (employee.authAccount.mfaEnabled) throw AppError.conflict("MFA is already enabled.");
      const secret = employee.authAccount.mfaSecretEncrypted
        ? decryptMfaSecret(employee.authAccount.mfaSecretEncrypted, loadEnv().JWT_REFRESH_SECRET)
        : createMfaSecret();
      if (!employee.authAccount.mfaSecretEncrypted) {
        await tx.staffAuthAccount.update({ where: { employeeId }, data: { mfaSecretEncrypted: encryptMfaSecret(secret, loadEnv().JWT_REFRESH_SECRET) } });
      }
      return { secret, uri: createMfaUri(secret, employee.email, "Attend Admin") };
    });
  }

  async confirmStaffMfa(employeeId: string, input: StaffMfaConfirmRequest): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    const current = await prisma.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
    if (!current?.active || !current.authAccount?.mfaSecretEncrypted) throw AppError.validationFailed("Start MFA setup before confirming a code.");
    const secret = decryptMfaSecret(current.authAccount.mfaSecretEncrypted, loadEnv().JWT_REFRESH_SECRET);
    if (!(await verifyMfaCode(secret, input.code))) throw AppError.invalidCredentials("The authenticator code is incorrect.");
    await prisma.$transaction(async (tx) => {
      await tx.staffAuthAccount.update({ where: { employeeId }, data: { mfaEnabled: true, refreshTokenVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId: current.locationId, action: "employee.mfa_enabled", entityType: "Employee", entityId: employeeId } });
    });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeInclude });
    return { tokens: this.issueEmployeeTokens(employee), employee: employeeToProfile(employee) };
  }

  async staffRefresh(refreshToken: string): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    const env = loadEnv();
    const payload = this.safeVerifyRefresh(refreshToken, env.JWT_REFRESH_SECRET);

    if (payload.actorType !== "EMPLOYEE") {
      throw AppError.unauthenticated();
    }

    const employee = await prisma.employee.findUnique({
      where: { id: payload.sub },
      include: employeeInclude,
    });

    if (!employee || !employee.active || !employee.location.organization.active || !employee.authAccount) {
      throw AppError.unauthenticated();
    }

    if (employee.authAccount.refreshTokenVersion !== payload.tokenVersion) {
      // The refresh token was issued before a logout/invalidation bumped
      // the version — reject rather than silently re-trusting it.
      throw AppError.unauthenticated("Session has been invalidated. Please log in again.");
    }

    const tokens = this.issueEmployeeTokens(employee);
    return { tokens, employee: employeeToProfile(employee) };
  }

  async staffLogout(employeeId: string): Promise<void> {
    await prisma.staffAuthAccount.update({
      where: { employeeId },
      data: { refreshTokenVersion: { increment: 1 } },
    });

    await this.audit.record({
      actorType: "EMPLOYEE",
      actorId: employeeId,
      action: "employee.logout",
      entityType: "Employee",
      entityId: employeeId,
    });
  }

  async staffMe(employeeId: string): Promise<AuthenticatedEmployee> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: employeeInclude,
    });
    if (!employee) throw AppError.notFound("Employee not found.");
    return employeeToProfile(employee);
  }

  async changeStaffPassword(employeeId: string, input: StaffPasswordChangeRequest, requestId: string): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid password-change idempotency key is required.");
    const employee = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "employeeId" FROM "staff_auth_accounts" WHERE "employeeId" = ${employeeId} FOR UPDATE`;
      const current = await tx.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
      if (!current?.active || !current.authAccount) throw AppError.unauthenticated();
      const completed = await tx.auditEvent.findMany({
        where: { actorType: "EMPLOYEE", actorId: employeeId, action: "employee.password_changed", entityType: "Employee", entityId: employeeId },
        select: { afterState: true },
      });
      const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
      if (replay) {
        if (!(await verifyPassword(current.authAccount.passwordHash, input.newPassword))) throw AppError.conflict("The password-change request id was already used with different details.");
        return current;
      }
      if (!(await verifyPassword(current.authAccount.passwordHash, input.currentPassword))) throw AppError.invalidCredentials("Current password is incorrect.");
      if (await verifyPassword(current.authAccount.passwordHash, input.newPassword)) throw AppError.validationFailed("Choose a password that differs from the temporary password.");
      const passwordHash = await hashPassword(input.newPassword);
      const authAccount = await tx.staffAuthAccount.update({ where: { employeeId }, data: { passwordHash, mustChangePassword: false, refreshTokenVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId: current.locationId, action: "employee.password_changed", entityType: "Employee", entityId: employeeId, afterState: { mustChangePassword: false, requestId } } });
      return { ...current, authAccount };
    });
    return { tokens: this.issueEmployeeTokens(employee), employee: employeeToProfile(employee) };
  }

  private issueEmployeeTokens(employee: EmployeeWithRoles): TokenPair {
    const env = loadEnv();
    return signTokenPair(
      {
        sub: employee.id,
        actorType: "EMPLOYEE",
        locationId: employee.locationId,
        permissions: employee.authAccount!.mustChangePassword ? [] : flattenEmployeePermissions(employee),
      },
      {
        sub: employee.id,
        actorType: "EMPLOYEE",
        tokenVersion: employee.authAccount!.refreshTokenVersion,
      },
      {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      },
    );
  }

  // ---------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------

  async customerRegister(
    input: CustomerRegisterRequest,
    requestId: string,
  ): Promise<{ tokens: TokenPair; customer: AuthenticatedCustomer }> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid registration idempotency key is required.");
    const normalizedEmail = input.email.toLowerCase();
    const normalizedName = input.name ?? null;
    const customer = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedEmail})::bigint)`;
      const existing = await tx.customer.findUnique({ where: { email: normalizedEmail }, include: { authAccount: true } });
      if (existing?.authAccount?.passwordHash) {
        const completed = await tx.auditEvent.findMany({
          where: { actorType: "CUSTOMER", actorId: existing.id, action: "customer.registered", entityType: "Customer", entityId: existing.id },
          select: { afterState: true },
        });
        const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
        if (!replay) throw AppError.conflict("An account with this email already exists.");
        const matches = replay.email === normalizedEmail && replay.name === normalizedName && await verifyPassword(existing.authAccount.passwordHash, input.password);
        if (!matches) throw AppError.conflict("The registration request id was already used with different details.");
        return existing;
      }
      const passwordHash = await hashPassword(input.password);
      const registered = existing
        ? await tx.customer.update({
          where: { id: existing.id },
          data: {
            name: normalizedName,
            isGuest: false,
            authAccount: { create: { passwordHash } },
          },
          include: { authAccount: true },
        })
        : await tx.customer.create({
          data: {
            email: normalizedEmail,
            name: normalizedName,
            isGuest: false,
            authAccount: { create: { passwordHash } },
          },
          include: { authAccount: true },
        });
      await this.audit.record({
        actorType: "CUSTOMER", actorId: registered.id, action: "customer.registered",
        entityType: "Customer", entityId: registered.id,
        afterState: { requestId, email: normalizedEmail, name: normalizedName },
      }, tx);
      return registered;
    });

    const tokens = this.issueCustomerTokens(customer.id, customer.authAccount!.refreshTokenVersion);
    return { tokens, customer: this.customerToProfile(customer) };
  }

  async customerLogin(input: CustomerLoginRequest): Promise<{ tokens: TokenPair; customer: AuthenticatedCustomer }> {
    const customer = await prisma.customer.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { authAccount: true },
    });

    if (!customer || !customer.authAccount || !customer.authAccount.passwordHash) {
      throw AppError.invalidCredentials();
    }

    const ok = await verifyPassword(customer.authAccount.passwordHash, input.password);
    if (!ok) throw AppError.invalidCredentials();

    const tokens = this.issueCustomerTokens(customer.id, customer.authAccount.refreshTokenVersion);
    return { tokens, customer: this.customerToProfile(customer) };
  }

  async customerRefresh(refreshToken: string): Promise<{ tokens: TokenPair; customer: AuthenticatedCustomer }> {
    const env = loadEnv();
    const payload = this.safeVerifyRefresh(refreshToken, env.JWT_REFRESH_SECRET);

    if (payload.actorType !== "CUSTOMER") {
      throw AppError.unauthenticated();
    }

    const customer = await prisma.customer.findUnique({
      where: { id: payload.sub },
      include: { authAccount: true },
    });

    if (!customer || !customer.authAccount) throw AppError.unauthenticated();
    if (customer.authAccount.refreshTokenVersion !== payload.tokenVersion) {
      throw AppError.unauthenticated("Session has been invalidated. Please log in again.");
    }

    const tokens = this.issueCustomerTokens(customer.id, customer.authAccount.refreshTokenVersion);
    return { tokens, customer: this.customerToProfile(customer) };
  }

  async customerLogout(refreshToken: string): Promise<void> {
    const env = loadEnv();
    const payload = this.safeVerifyRefresh(refreshToken, env.JWT_REFRESH_SECRET);
    if (payload.actorType !== "CUSTOMER") throw AppError.unauthenticated();
    const result = await prisma.customerAuthAccount.updateMany({
      where: { customerId: payload.sub, refreshTokenVersion: payload.tokenVersion },
      data: { refreshTokenVersion: { increment: 1 } },
    });
    if (result.count === 1) return;
    const account = await prisma.customerAuthAccount.findUnique({
      where: { customerId: payload.sub },
      select: { refreshTokenVersion: true },
    });
    if (!account || account.refreshTokenVersion <= payload.tokenVersion) throw AppError.unauthenticated();
  }

  async requestCustomerPasswordReset(input: CustomerPasswordResetRequest, requestId: string): Promise<void> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid password-reset request idempotency key is required.");
    const normalizedEmail = input.email.toLowerCase();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedEmail})::bigint)`;
      const customer = await tx.customer.findUnique({ where: { email: normalizedEmail }, include: { authAccount: true } });
      if (!customer?.email || !customer.authAccount?.passwordHash) return;
      const completed = await tx.auditEvent.findMany({
        where: { actorType: "CUSTOMER", actorId: customer.id, action: "customer.password_reset_requested", entityType: "Customer", entityId: customer.id },
        select: { afterState: true },
      });
      if (completed.some(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) && (afterState as Record<string, unknown>).requestId === requestId)) return;

      const env = loadEnv();
      const token = signCustomerPasswordResetToken({ sub: customer.id, tokenVersion: customer.authAccount.refreshTokenVersion, purpose: "customer-password-reset" }, env.JWT_REFRESH_SECRET);
      const customerWebUrl = env.CUSTOMER_WEB_URL.replace(/\/$/, "");
      try {
        const delivery = await this.emailProvider.sendCustomerPasswordReset({
          to: customer.email, customerName: customer.name,
          resetUrl: `${customerWebUrl}/account#resetPassword=${encodeURIComponent(token)}`,
          expiresInMinutes: 30,
        });
        await this.audit.record({
          actorType: "CUSTOMER", actorId: customer.id, action: "customer.password_reset_requested",
          entityType: "Customer", entityId: customer.id,
          afterState: { requestId, messageId: delivery.messageId },
        }, tx);
      } catch (error) {
        await this.audit.record({
          actorType: "SYSTEM", action: "customer.password_reset_delivery_failed",
          entityType: "Customer", entityId: customer.id,
          afterState: { requestId, error: (error instanceof Error ? error.message : "Unknown email delivery error").slice(0, 1000) },
        }, tx);
      }
    });
  }

  async resetCustomerPassword(input: CustomerPasswordResetConfirm, requestId: string): Promise<void> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid password-reset idempotency key is required.");
    let payload;
    try {
      payload = verifyCustomerPasswordResetToken(input.token, loadEnv().JWT_REFRESH_SECRET);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw AppError.validationFailed("This password reset link is invalid or expired.");
      }
      throw error;
    }
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "customerId" FROM "customer_auth_accounts" WHERE "customerId" = ${payload.sub} FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id: payload.sub }, include: { authAccount: true } });
      if (!customer?.authAccount?.passwordHash) throw AppError.validationFailed("This password reset link is invalid or expired.");
      const completed = await tx.auditEvent.findMany({
        where: { actorType: "CUSTOMER", actorId: customer.id, action: "customer.password_reset", entityType: "Customer", entityId: customer.id },
        select: { afterState: true },
      });
      const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
      if (replay) {
        if (!(await verifyPassword(customer.authAccount.passwordHash, input.newPassword))) throw AppError.conflict("The password-reset request id was already used with different details.");
        return;
      }
      if (customer.authAccount.refreshTokenVersion !== payload.tokenVersion) throw AppError.validationFailed("This password reset link is invalid or expired.");
      if (await verifyPassword(customer.authAccount.passwordHash, input.newPassword)) throw AppError.validationFailed("Choose a password that differs from your current password.");
      const passwordHash = await hashPassword(input.newPassword);
      const result = await tx.customerAuthAccount.updateMany({
        where: { customerId: customer.id, refreshTokenVersion: payload.tokenVersion },
        data: { passwordHash, refreshTokenVersion: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw AppError.validationFailed("This password reset link is invalid or expired.");
      }
      await this.audit.record({
        actorType: "CUSTOMER",
        actorId: customer.id,
        action: "customer.password_reset",
        entityType: "Customer",
        entityId: customer.id,
        afterState: { requestId },
      }, tx);
    });
  }

  async changeCustomerPassword(
    customerId: string,
    input: CustomerPasswordChangeRequest,
    requestId: string,
  ): Promise<{ tokens: TokenPair; customer: AuthenticatedCustomer }> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid password-change idempotency key is required.");
    const customer = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "customerId" FROM "customer_auth_accounts" WHERE "customerId" = ${customerId} FOR UPDATE`;
      const current = await tx.customer.findUnique({ where: { id: customerId }, include: { authAccount: true } });
      if (!current?.authAccount?.passwordHash) throw AppError.unauthenticated();
      const completed = await tx.auditEvent.findMany({
        where: { actorType: "CUSTOMER", actorId: customerId, action: "customer.password_changed", entityType: "Customer", entityId: customerId },
        select: { afterState: true },
      });
      const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
      if (replay) {
        if (!(await verifyPassword(current.authAccount.passwordHash, input.newPassword))) throw AppError.conflict("The password-change request id was already used with different details.");
        return current;
      }
      if (!(await verifyPassword(current.authAccount.passwordHash, input.currentPassword))) throw AppError.invalidCredentials("Current password is incorrect.");
      if (await verifyPassword(current.authAccount.passwordHash, input.newPassword)) throw AppError.validationFailed("Choose a password that differs from your current password.");
      const passwordHash = await hashPassword(input.newPassword);
      const authAccount = await tx.customerAuthAccount.update({
        where: { customerId }, data: { passwordHash, refreshTokenVersion: { increment: 1 } },
      });
      await this.audit.record({
        actorType: "CUSTOMER", actorId: customerId, action: "customer.password_changed",
        entityType: "Customer", entityId: customerId, afterState: { requestId },
      }, tx);
      return { ...current, authAccount };
    });
    return {
      tokens: this.issueCustomerTokens(customer.id, customer.authAccount!.refreshTokenVersion),
      customer: this.customerToProfile(customer),
    };
  }

  async customerAccount(customerId: string): Promise<CustomerAccountResponse> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        authAccount: true,
        ticketOrders: {
          where: { status: { not: "CART" } },
          orderBy: { createdAt: "desc" },
          include: {
            location: { select: { name: true } },
            tickets: {
              orderBy: { issuedAt: "asc" },
              include: {
                ticketType: true,
                showtimeSeat: {
                  include: {
                    seat: true,
                    showtime: { include: { movie: true, auditorium: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!customer?.authAccount) throw AppError.unauthenticated();

    return {
      customer: this.customerToProfile(customer),
      orders: customer.ticketOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalCents: order.totalCents,
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        locationName: order.location.name,
        tickets: order.tickets.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          qrToken: ticket.qrToken,
          priceCentsPaid: ticket.priceCentsPaid,
          seatLabel: ticket.showtimeSeat.seat.label,
          ticketTypeName: ticket.ticketType.name,
          movieTitle: ticket.showtimeSeat.showtime.movie.title,
          moviePosterUrl: ticket.showtimeSeat.showtime.movie.posterUrl,
          auditoriumName: ticket.showtimeSeat.showtime.auditorium.name,
          startsAt: ticket.showtimeSeat.showtime.startsAt.toISOString(),
          endsAt: ticket.showtimeSeat.showtime.endsAt.toISOString(),
        })),
      })),
    };
  }

  async updateCustomerProfile(
    customerId: string,
    input: CustomerProfileUpdateRequest,
    requestId: string,
  ): Promise<AuthenticatedCustomer> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid profile-update idempotency key is required.");
    const requestFingerprint = JSON.stringify({ name: input.name });

    const customer = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`;
      const current = await tx.customer.findFirst({
        where: { id: customerId, authAccount: { isNot: null } },
      });
      if (!current) throw AppError.unauthenticated();
      const completed = await tx.auditEvent.findMany({
        where: { actorType: "CUSTOMER", actorId: customerId, action: "customer.profile_updated", entityType: "Customer", entityId: customerId },
        select: { afterState: true },
      });
      const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) throw AppError.conflict("The profile-update request id was already used with different details.");
        return current;
      }
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { name: input.name },
      });
      await this.audit.record({
        actorType: "CUSTOMER",
        actorId: customerId,
        action: "customer.profile_updated",
        entityType: "Customer",
        entityId: customerId,
        beforeState: { name: current.name },
        afterState: { requestId, requestFingerprint, name: updated.name },
      }, tx);
      return updated;
    });
    return this.customerToProfile(customer);
  }

  async requestCustomerEmailChange(
    customerId: string,
    input: CustomerEmailChangeRequest,
    requestId: string,
  ): Promise<void> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid email change idempotency key is required.");
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { authAccount: true },
    });
    if (!customer?.email || !customer.authAccount?.passwordHash) {
      throw AppError.unauthenticated();
    }
    if (!(await verifyPassword(customer.authAccount.passwordHash, input.password))) {
      throw AppError.invalidCredentials("Password is incorrect.");
    }
    const newEmail = input.newEmail.toLowerCase();
    if (newEmail === customer.email.toLowerCase()) {
      throw AppError.validationFailed("Enter a different email address.");
    }
    if (await prisma.customer.findUnique({ where: { email: newEmail } })) {
      throw AppError.conflict("That email address cannot be used.");
    }

    const env = loadEnv();
    const token = signCustomerEmailChangeToken({
      sub: customer.id,
      tokenVersion: customer.authAccount.refreshTokenVersion,
      newEmail,
      purpose: "customer-email-change",
    }, env.JWT_REFRESH_SECRET);
    const customerWebUrl = env.CUSTOMER_WEB_URL.replace(/\/$/, "");
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customer.id} FOR UPDATE`;
        const completed = await tx.auditEvent.findMany({
          where: { actorType: "CUSTOMER", actorId: customer.id, action: "customer.email_change_requested", entityType: "Customer", entityId: customer.id },
          select: { afterState: true },
        });
        const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
        if (replay) {
          if (replay.newEmail !== newEmail) throw AppError.conflict("The email change request id was already used for a different address.");
          return;
        }
        const delivery = await this.emailProvider.sendCustomerEmailChange({
          to: newEmail, customerName: customer.name,
          verificationUrl: `${customerWebUrl}/account#emailChange=${encodeURIComponent(token)}`,
          expiresInMinutes: 30,
        });
        await this.audit.record({
          actorType: "CUSTOMER", actorId: customer.id, action: "customer.email_change_requested",
          entityType: "Customer", entityId: customer.id,
          afterState: { requestId, newEmail, messageId: delivery.messageId },
        }, tx);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      await this.audit.record({
        actorType: "SYSTEM",
        action: "customer.email_change_delivery_failed",
        entityType: "Customer",
        entityId: customer.id,
        afterState: {
          requestId,
          newEmail,
          error: (error instanceof Error ? error.message : "Unknown email delivery error").slice(0, 1000),
        },
      });
      throw AppError.validationFailed("The verification email could not be sent. Please try again.");
    }
  }

  async confirmCustomerEmailChange(input: CustomerEmailChangeConfirm, requestId: string): Promise<void> {
    if (requestId.length < 16) throw AppError.validationFailed("A valid email confirmation idempotency key is required.");
    let payload;
    try {
      payload = verifyCustomerEmailChangeToken(input.token, loadEnv().JWT_REFRESH_SECRET);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw AppError.validationFailed("This email verification link is invalid or expired.");
      }
      throw error;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${payload.sub} FOR UPDATE`;
        const customer = await tx.customer.findUnique({ where: { id: payload.sub }, include: { authAccount: true } });
        if (!customer?.authAccount) throw AppError.validationFailed("This email verification link is invalid or expired.");
        const completed = await tx.auditEvent.findMany({
          where: { actorType: "CUSTOMER", actorId: customer.id, action: "customer.email_changed", entityType: "Customer", entityId: customer.id },
          select: { afterState: true },
        });
        const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
        if (replay) {
          if (replay.email !== payload.newEmail || customer.email !== payload.newEmail) throw AppError.conflict("The email confirmation request id was already used with different details.");
          return;
        }
        if (customer.authAccount.refreshTokenVersion !== payload.tokenVersion) throw AppError.validationFailed("This email verification link is invalid or expired.");
        const existing = await tx.customer.findFirst({ where: { email: payload.newEmail, id: { not: customer.id } } });
        if (existing) throw AppError.conflict("That email address cannot be used.");
        const authUpdate = await tx.customerAuthAccount.updateMany({
          where: { customerId: customer.id, refreshTokenVersion: payload.tokenVersion },
          data: { refreshTokenVersion: { increment: 1 } },
        });
        if (authUpdate.count !== 1) {
          throw AppError.validationFailed("This email verification link is invalid or expired.");
        }
        await tx.customer.update({
          where: { id: customer.id },
          data: { email: payload.newEmail },
        });
        await this.audit.record({
          actorType: "CUSTOMER",
          actorId: customer.id,
          action: "customer.email_changed",
          entityType: "Customer",
          entityId: customer.id,
          beforeState: { email: customer.email },
          afterState: { requestId, email: payload.newEmail },
        }, tx);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw AppError.conflict("That email address cannot be used.");
      }
      throw error;
    }
  }

  async resendCustomerReceipt(customerId: string, orderId: string, requestId: string) {
    if (requestId.length < 16) throw AppError.validationFailed("A valid receipt resend idempotency key is required.");
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ticket_orders" WHERE "id" = ${orderId} FOR UPDATE`;
        const order = await tx.ticketOrder.findFirst({
          where: { id: orderId, customerId, status: { in: ["PAID", "EXCHANGED"] }, customer: { authAccount: { isNot: null } } },
          include: { customer: true, tickets: { where: { status: { in: ["ISSUED", "ADMITTED"] } }, include: { ticketType: true, showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } } } } },
        });
        if (!order?.customer?.email || order.tickets.length === 0) throw AppError.notFound("Receiptable ticket order was not found.");
        const completed = await tx.auditEvent.findMany({
          where: { actorType: "CUSTOMER", actorId: customerId, action: "ticket_order.receipt_resent", entityType: "TicketOrder", entityId: order.id },
          select: { afterState: true },
        });
        const replay = completed.map(({ afterState }) => afterState && typeof afterState === "object" && !Array.isArray(afterState) ? afterState as Record<string, unknown> : undefined).find((state) => state?.requestId === requestId);
        if (replay) {
          if (replay.email !== order.customer.email) throw AppError.conflict("The receipt resend request id was already used for a different account email.");
          return { receiptDelivery: "SENT" as const, email: order.customer.email };
        }
        const receipt: TicketReceipt = {
          to: order.customer.email, guestName: order.customer.name, orderNumber: order.orderNumber, totalCents: order.totalCents, currency: order.currency,
          tickets: order.tickets.map((ticket) => ({ id: ticket.id, credential: ticket.qrToken, movie: ticket.showtimeSeat.showtime.movie.title, auditorium: ticket.showtimeSeat.showtime.auditorium.name, seat: ticket.showtimeSeat.showtime.auditorium.seatingMode === "GENERAL_ADMISSION" ? "General admission" : ticket.showtimeSeat.seat.label, ticketType: ticket.ticketType.name, startsAt: ticket.showtimeSeat.showtime.startsAt })),
        };
        const delivery = await this.emailProvider.sendTicketReceipt(receipt);
        await tx.ticketOrder.update({
          where: { id: order.id },
          data: {
            guestEmail: order.customer!.email,
            receiptEmailSentAt: new Date(),
            receiptEmailMessageId: delivery.messageId,
            receiptEmailClaimedAt: null,
            receiptEmailError: null,
          },
        });
        await this.audit.record({
          actorType: "CUSTOMER",
          actorId: customerId,
          locationId: order.locationId,
          action: "ticket_order.receipt_resent",
          entityType: "TicketOrder",
          entityId: order.id,
          afterState: { requestId, email: order.customer.email, messageId: delivery.messageId },
        }, tx);
        return { receiptDelivery: "SENT" as const, email: order.customer.email };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : "Unknown email delivery error";
      const order = await prisma.ticketOrder.findFirst({ where: { id: orderId, customerId }, include: { customer: true } });
      if (!order?.customer?.email) throw AppError.notFound("Receiptable ticket order was not found.");
      const customerEmail = order.customer.email;
      await prisma.$transaction(async (tx) => {
        await tx.ticketOrder.update({
          where: { id: order.id },
          data: { receiptEmailClaimedAt: null, receiptEmailError: message.slice(0, 1000) },
        });
        await this.audit.record({
          actorType: "CUSTOMER",
          actorId: customerId,
          locationId: order.locationId,
          action: "ticket_order.receipt_resend_failed",
          entityType: "TicketOrder",
          entityId: order.id,
          afterState: { requestId, email: customerEmail, error: message.slice(0, 1000) },
        }, tx);
      });
      return { receiptDelivery: "FAILED" as const, email: customerEmail };
    }
  }

  private issueCustomerTokens(customerId: string, tokenVersion: number): TokenPair {
    const env = loadEnv();
    return signTokenPair(
      { sub: customerId, actorType: "CUSTOMER", permissions: [] },
      { sub: customerId, actorType: "CUSTOMER", tokenVersion },
      {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      },
    );
  }

  private customerToProfile(customer: {
    id: string;
    email: string | null;
    name: string | null;
    isGuest: boolean;
  }): AuthenticatedCustomer {
    return { id: customer.id, email: customer.email, name: customer.name, isGuest: customer.isGuest };
  }

  private safeVerifyRefresh(token: string, secret: string) {
    try {
      return verifyRefreshToken(token, secret);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw AppError.unauthenticated("Refresh token invalid or expired. Please log in again.");
      }
      throw err;
    }
  }
}
