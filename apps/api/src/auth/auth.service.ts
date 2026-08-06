import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@cinema/database";
import {
  hashPassword,
  verifyPassword,
  signTokenPair,
  verifyRefreshToken,
  InvalidTokenError,
  TokenPair,
} from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import {
  AuthenticatedCustomer,
  CustomerAccountResponse,
  AuthenticatedEmployee,
  CustomerLoginRequest,
  CustomerRegisterRequest,
  StaffLoginRequest,
} from "@cinema/shared";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";

const employeeInclude = {
  authAccount: true,
  location: true,
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
    permissions: flattenEmployeePermissions(employee),
    timeClockEnabled: employee.location.timeClockEnabled,
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

    if (!employee || !employee.active || !employee.authAccount) {
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

    if (!employee || !employee.active || !employee.authAccount) {
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

  private issueEmployeeTokens(employee: EmployeeWithRoles): TokenPair {
    const env = loadEnv();
    return signTokenPair(
      {
        sub: employee.id,
        actorType: "EMPLOYEE",
        locationId: employee.locationId,
        permissions: flattenEmployeePermissions(employee),
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

  async customerLogout(customerId: string): Promise<void> {
    await prisma.customerAuthAccount.update({
      where: { customerId },
      data: { refreshTokenVersion: { increment: 1 } },
    });
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
