import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@cinema/database";
import {
  hashPassword,
  verifyPassword,
  signTokenPair,
  verifyRefreshToken,
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
  CustomerRegisterRequest,
  StaffLoginRequest,
  StaffPasswordChangeRequest,
  StaffMfaConfirmRequest,
  StaffMfaVerifyRequest,
} from "@cinema/shared";
import type { RequestActor } from "./types";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";

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
  constructor(private readonly audit: AuditService) {}

  // ---------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------

  async staffLogin(input: StaffLoginRequest): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    const employee = await prisma.employee.findUnique({
      where: { email: input.email },
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
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
    if (!employee?.active || !employee.authAccount) throw AppError.unauthenticated();
    if (employee.authAccount.mustChangePassword) throw AppError.forbidden("Change your temporary password before setting up MFA.");
    if (employee.authAccount.mfaEnabled) throw AppError.conflict("MFA is already enabled.");
    const secret = createMfaSecret();
    await prisma.staffAuthAccount.update({ where: { employeeId }, data: { mfaSecretEncrypted: encryptMfaSecret(secret, loadEnv().JWT_REFRESH_SECRET) } });
    return { secret, uri: createMfaUri(secret, employee.email, "Attend Admin") };
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

  async changeStaffPassword(employeeId: string, input: StaffPasswordChangeRequest): Promise<{ tokens: TokenPair; employee: AuthenticatedEmployee }> {
    const current = await prisma.employee.findUnique({ where: { id: employeeId }, include: employeeInclude });
    if (!current?.active || !current.authAccount) throw AppError.unauthenticated();
    if (!(await verifyPassword(current.authAccount.passwordHash, input.currentPassword))) throw AppError.invalidCredentials("Current password is incorrect.");
    if (await verifyPassword(current.authAccount.passwordHash, input.newPassword)) throw AppError.validationFailed("Choose a password that differs from the temporary password.");
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.staffAuthAccount.update({ where: { employeeId }, data: { passwordHash, mustChangePassword: false, refreshTokenVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId: current.locationId, action: "employee.password_changed", entityType: "Employee", entityId: employeeId, afterState: { mustChangePassword: false } } });
    });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeInclude });
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
  ): Promise<{ tokens: TokenPair; customer: AuthenticatedCustomer }> {
    const normalizedEmail = input.email.toLowerCase();
    const existing = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
      include: { authAccount: true },
    });
    if (existing?.authAccount) {
      throw AppError.conflict("An account with this email already exists.");
    }

    const passwordHash = await hashPassword(input.password);
    const customer = existing
      ? await prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            isGuest: false,
            authAccount: { create: { passwordHash } },
          },
          include: { authAccount: true },
        })
      : await prisma.customer.create({
          data: {
            email: normalizedEmail,
            name: input.name,
            isGuest: false,
            authAccount: { create: { passwordHash } },
          },
          include: { authAccount: true },
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
    if (result.count !== 1) throw AppError.unauthenticated("Session has already been invalidated.");
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
          movieTitle: ticket.showtimeSeat.showtime.movie.title,
          moviePosterUrl: ticket.showtimeSeat.showtime.movie.posterUrl,
          auditoriumName: ticket.showtimeSeat.showtime.auditorium.name,
          startsAt: ticket.showtimeSeat.showtime.startsAt.toISOString(),
        })),
      })),
    };
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
