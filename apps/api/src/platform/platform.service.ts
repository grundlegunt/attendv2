import { Inject, Injectable } from "@nestjs/common";
import {
  ConnectOnboardingStatus,
  PlatformUserRole,
  Prisma,
  prisma,
} from "@cinema/database";
import {
  DEFAULT_ROLE_PERMISSIONS,
  hashPassword,
  InvalidTokenError,
  Permission,
  RoleKey,
  signTokenPair,
  TokenPair,
  verifyPassword,
  verifyRefreshToken,
} from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import {
  adminBrandingDefaults,
  adminBrandingSchema,
  AdminUiConfig,
  adminUiConfigSchema,
  adminUiDefaults,
  CinemaContent,
  cinemaContentDefaults,
  cinemaContentSchema,
  createAuditoriumRequestSchema,
  customerBrandingSchema,
  PlatformLoginRequest,
  updateAuditoriumLayoutRequestSchema,
  validateAdvancedSeatLayout,
  validateSeatLayout,
} from "@cinema/shared";
import { z } from "zod";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";
import type {
  ConnectAccountState,
  ConnectOnboardingProvider,
} from "@cinema/payments";
import { CONNECT_ONBOARDING_PROVIDER } from "./connect-onboarding.module";
import { ReportingService } from "../reporting/reporting.service";
import { permissionsForPlatformRole } from "./platform-permissions";

const platformBrandingDraftSchema = customerBrandingSchema
  .omit({ name: true })
  .merge(adminBrandingSchema)
  .extend({ adminUi: adminUiConfigSchema })
  .strict();
type PlatformBrandingDraft = z.infer<typeof platformBrandingDraftSchema>;
type PlatformAuditoriumInput = z.infer<typeof createAuditoriumRequestSchema>;
type PlatformAuditoriumUpdateInput = z.infer<
  typeof updateAuditoriumLayoutRequestSchema
>;

@Injectable()
export class PlatformService {
  constructor(
    private readonly audit: AuditService,
    @Inject(CONNECT_ONBOARDING_PROVIDER)
    private readonly connect: ConnectOnboardingProvider,
    private readonly reporting: ReportingService,
  ) {}

  async login(input: PlatformLoginRequest) {
    const user = await prisma.platformUser.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (
      !user ||
      !user.active ||
      !(await verifyPassword(user.passwordHash, input.password))
    ) {
      throw AppError.invalidCredentials();
    }

    const tokens = this.issueTokens(
      user.id,
      user.refreshTokenVersion,
      user.role,
    );
    await this.audit.record({
      actorType: "PLATFORM",
      actorId: user.id,
      action: "platform.login",
      entityType: "PlatformUser",
      entityId: user.id,
    });
    return {
      tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async refreshSession(refreshToken: string) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken, loadEnv().JWT_REFRESH_SECRET);
    } catch (error) {
      if (error instanceof InvalidTokenError)
        throw AppError.unauthenticated(
          "The Attend Master session expired. Please sign in again.",
        );
      throw error;
    }
    if (payload.actorType !== "PLATFORM") throw AppError.unauthenticated();
    const user = await prisma.platformUser.findUnique({
      where: { id: payload.sub },
    });
    if (!user?.active || user.refreshTokenVersion !== payload.tokenVersion) {
      throw AppError.unauthenticated(
        "The Attend Master session is no longer valid. Please sign in again.",
      );
    }
    return {
      tokens: this.issueTokens(user.id, user.refreshTokenVersion, user.role),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async logout(userId: string): Promise<void> {
    await prisma.platformUser.update({
      where: { id: userId },
      data: { refreshTokenVersion: { increment: 1 } },
    });
    await this.audit.record({
      actorType: "PLATFORM",
      actorId: userId,
      action: "platform.logout",
      entityType: "PlatformUser",
      entityId: userId,
    });
  }

  async overview() {
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: { locations: { orderBy: { name: "asc" } } },
    });

    return {
      generatedAt: new Date().toISOString(),
      organizations: await Promise.all(
        organizations.map(async (organization) => ({
          id: organization.id,
          name: organization.name,
          legalName: organization.legalName,
          businessTypeLabel: organization.businessTypeLabel,
          defaultSeatingMode: organization.defaultSeatingMode,
          timezone: organization.timezone,
          active: organization.active,
          payments: {
            connected: Boolean(organization.stripeConnectedAccountId),
            onboardingStatus: organization.connectOnboardingStatus,
          },
          locations: await Promise.all(
            organization.locations.map(async (location) => {
              const [auditoriums, employees, menuItems, upcomingShowtimes] =
                await Promise.all([
                  prisma.auditorium.count({
                    where: { locationId: location.id, active: true },
                  }),
                  prisma.employee.count({
                    where: {
                      locationId: location.id,
                      active: true,
                      deletedAt: null,
                    },
                  }),
                  prisma.menuItem.count({
                    where: {
                      active: true,
                      is86d: false,
                      menuCategory: { locationId: location.id, active: true },
                    },
                  }),
                  prisma.showtime.count({
                    where: {
                      auditorium: { locationId: location.id },
                      onSale: true,
                      startsAt: { gte: new Date() },
                    },
                  }),
                ]);
              const brandingFields = [
                location.customerAccentColor,
                location.customerBackgroundColor,
                location.customerBackgroundGlowColor,
                location.customerTextColor,
              ];
              return {
                id: location.id,
                name: location.name,
                address: location.address,
                timezone: location.timezone,
                active: location.active,
                configuration: {
                  branding:
                    brandingFields.some(Boolean) ||
                    Boolean(location.customerLogoUrl),
                  auditoriums,
                  employees,
                  menuItems,
                  upcomingShowtimes,
                },
              };
            }),
          ),
        })),
      ),
    };
  }

  async revenue(input: {
    from?: string;
    to?: string;
    organizationId?: string;
  }) {
    const from = input.from
      ? new Date(input.from)
      : new Date(Date.now() - 7 * 86_400_000);
    const to = input.to ? new Date(input.to) : new Date();
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to ||
      to.getTime() - from.getTime() > 366 * 86_400_000
    ) {
      throw AppError.validationFailed(
        "A valid revenue date range of 366 days or less is required.",
      );
    }
    const organizations = await prisma.organization.findMany({
      where: input.organizationId ? { id: input.organizationId } : undefined,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        locations: { where: { active: true }, select: { id: true } },
      },
    });
    if (input.organizationId && organizations.length === 0)
      throw AppError.notFound("Cinema client not found.");
    const zero = () => ({
      ticketRevenueCents: 0,
      ticketFeesCents: 0,
      ticketTaxCents: 0,
      ticketCollectedCents: 0,
      fnbRevenueCents: 0,
      combinedRevenueCents: 0,
      refundedCents: 0,
      ticketsSold: 0,
      fnbOrders: 0,
    });
    const clients = await Promise.all(
      organizations.map(async (organization) => {
        const totals = zero();
        const reports = await Promise.all(
          organization.locations.map((location) =>
            this.reporting.revenue(location.id, { from, to }),
          ),
        );
        for (const report of reports)
          for (const key of Object.keys(totals) as Array<keyof typeof totals>)
            totals[key] += report.totals[key];
        return {
          id: organization.id,
          name: organization.name,
          locations: organization.locations.length,
          ...totals,
        };
      }),
    );
    const totals = zero();
    for (const client of clients)
      for (const key of Object.keys(totals) as Array<keyof typeof totals>)
        totals[key] += client[key];
    return {
      generatedAt: new Date().toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      totals,
      clients,
    };
  }

  revenueCsv(report: Awaited<ReturnType<PlatformService["revenue"]>>) {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    const columns = [
      "Client",
      "Locations",
      "Tickets sold",
      "Ticket face value (cents)",
      "Attend ticket-fee revenue (cents)",
      "Ticket tax (cents)",
      "Ticket total collected (cents)",
      "F&B revenue (cents)",
      "Combined net (cents)",
      "Refunds (cents)",
      "F&B orders",
    ];
    const values = (
      client:
        | (typeof report.clients)[number]
        | (typeof report.totals & { name: string; locations: number }),
    ) => [
      client.name,
      client.locations,
      client.ticketsSold,
      client.ticketRevenueCents,
      client.ticketFeesCents,
      client.ticketTaxCents,
      client.ticketCollectedCents,
      client.fnbRevenueCents,
      client.combinedRevenueCents,
      client.refundedCents,
      client.fnbOrders,
    ];
    return [
      row(["Report from", report.range.from]),
      row(["Report to", report.range.to]),
      "",
      row(columns),
      row(
        values({
          name: "TOTAL",
          locations: report.clients.reduce(
            (sum, client) => sum + client.locations,
            0,
          ),
          ...report.totals,
        }),
      ),
      ...report.clients.map((client) => row(values(client))),
    ].join("\n");
  }

  async auditEvents(input: {
    limit?: string;
    offset?: string;
    organizationId?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }) {
    const take = Math.max(1, Math.min(Number(input.limit) || 100, 200));
    const skip = Math.max(0, Math.min(Number(input.offset) || 0, 10_000));
    const start = input.from ? new Date(input.from) : undefined;
    const end = input.to ? new Date(input.to) : undefined;
    if (
      (start && Number.isNaN(start.getTime())) ||
      (end && Number.isNaN(end.getTime())) ||
      (start && end && start >= end)
    ) {
      throw AppError.validationFailed("A valid audit date range is required.");
    }
    const where: Prisma.AuditEventWhereInput = {
      actorType: "PLATFORM",
      ...(input.action
        ? { action: { contains: input.action, mode: "insensitive" } }
        : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(start || end
        ? {
            occurredAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lt: end } : {}),
            },
          }
        : {}),
      ...(input.organizationId
        ? {
            OR: [
              { location: { organizationId: input.organizationId } },
              { entityType: "Organization", entityId: input.organizationId },
            ],
          }
        : {}),
    };
    const [events, total] = await prisma.$transaction([
      prisma.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take,
        skip,
        include: {
          location: {
            select: {
              name: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.auditEvent.count({ where }),
    ]);
    const organizationEventIds = [
      ...new Set(
        events
          .filter((event) => event.entityType === "Organization")
          .map((event) => event.entityId),
      ),
    ];
    const [actors, organizations] = await Promise.all([
      prisma.platformUser.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
      prisma.organization.findMany({
        where: { id: { in: organizationEventIds } },
        select: { id: true, name: true },
      }),
    ]);
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const organizationById = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
    return {
      total,
      limit: take,
      offset: skip,
      actors,
      events: events.map((event) => {
        const actor = event.actorId ? actorById.get(event.actorId) : undefined;
        const organization =
          event.location?.organization ??
          (event.entityType === "Organization"
            ? organizationById.get(event.entityId)
            : undefined);
        return {
          id: event.id,
          occurredAt: event.occurredAt.toISOString(),
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          actor: actor
            ? { id: actor.id, name: actor.name, email: actor.email }
            : null,
          organization: organization
            ? { id: organization.id, name: organization.name }
            : null,
          location: event.location ? { name: event.location.name } : null,
          beforeState: event.beforeState,
          afterState: event.afterState,
        };
      }),
    };
  }

  async team() {
    const users = await prisma.platformUser.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      users: users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
    };
  }

  async createPlatformUser(input: {
    actorId: string;
    name: string;
    email: string;
    password: string;
    role: PlatformUserRole;
  }) {
    const email = input.email.toLowerCase();
    const duplicate = await prisma.platformUser.findUnique({
      where: { email },
    });
    if (duplicate)
      throw AppError.conflict(
        "An Attend Master operator with that email already exists.",
      );
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.platformUser.create({
          data: { name: input.name, email, passwordHash, role: input.role },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            action: "platform.user_created",
            entityType: "PlatformUser",
            entityId: created.id,
            afterState: {
              name: created.name,
              email: created.email,
              role: created.role,
              active: created.active,
            },
          },
          tx,
        );
        return created;
      });
      return {
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "An Attend Master operator with that email already exists.",
        );
      throw error;
    }
  }

  async updatePlatformUser(input: {
    actorId: string;
    userId: string;
    name?: string;
    active?: boolean;
    role?: PlatformUserRole;
  }) {
    if (input.userId === input.actorId && input.active === false)
      throw AppError.conflict(
        "You cannot deactivate your own Attend Master account.",
      );
    if (
      input.userId === input.actorId &&
      input.role &&
      input.role !== PlatformUserRole.OWNER
    )
      throw AppError.conflict("You cannot remove your own Owner role.");
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-team-access'))`;
      const before = await tx.platformUser.findUnique({
        where: { id: input.userId },
      });
      if (!before) throw AppError.notFound("Attend Master operator not found.");
      const removesActiveOwner =
        before.active &&
        before.role === PlatformUserRole.OWNER &&
        (input.active === false ||
          (input.role && input.role !== PlatformUserRole.OWNER));
      if (
        removesActiveOwner &&
        (await tx.platformUser.count({
          where: { active: true, role: PlatformUserRole.OWNER },
        })) <= 1
      ) {
        throw AppError.conflict(
          "The last active Attend Master Owner cannot be deactivated or reassigned.",
        );
      }
      const roleChanged =
        input.role !== undefined && input.role !== before.role;
      const updated = await tx.platformUser.update({
        where: { id: input.userId },
        data: {
          name: input.name,
          active: input.active,
          role: input.role,
          ...(input.active === false || roleChanged
            ? { refreshTokenVersion: { increment: 1 } }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          action: "platform.user_updated",
          entityType: "PlatformUser",
          entityId: updated.id,
          beforeState: {
            name: before.name,
            email: before.email,
            role: before.role,
            active: before.active,
          },
          afterState: {
            name: updated.name,
            email: updated.email,
            role: updated.role,
            active: updated.active,
          },
        },
        tx,
      );
      return updated;
    });
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async resetPlatformUserCredentials(input: {
    actorId: string;
    userId: string;
    password: string;
  }) {
    const target = await prisma.platformUser.findUnique({
      where: { id: input.userId },
    });
    if (!target) throw AppError.notFound("Attend Master operator not found.");
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction(async (tx) => {
      await tx.platformUser.update({
        where: { id: target.id },
        data: { passwordHash, refreshTokenVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          action: "platform.user_credentials_reset",
          entityType: "PlatformUser",
          entityId: target.id,
          afterState: { passwordReset: true },
        },
        tx,
      );
    });
    return { id: target.id, passwordReset: true };
  }

  async createOrganization(input: {
    actorId: string;
    name: string;
    legalName?: string | null;
    businessTypeLabel?: string | null;
    defaultSeatingMode?: "RESERVED" | "GENERAL_ADMISSION";
    timezone: string;
    location: { name: string; address?: string | null; timezone: string };
  }) {
    const organizationId = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          legalName: input.legalName,
          businessTypeLabel: input.businessTypeLabel,
          defaultSeatingMode: input.defaultSeatingMode,
          timezone: input.timezone,
          locations: {
            create: {
              name: input.location.name,
              address: input.location.address,
              timezone: input.location.timezone,
            },
          },
        },
        include: { locations: true },
      });
      const location = organization.locations[0];
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: location?.id,
          action: "platform.organization_created",
          entityType: "Organization",
          entityId: organization.id,
          afterState: {
            name: organization.name,
            legalName: organization.legalName,
            businessTypeLabel: organization.businessTypeLabel,
            defaultSeatingMode: organization.defaultSeatingMode,
            timezone: organization.timezone,
            initialLocationId: location?.id,
          },
        },
        tx,
      );
      return organization.id;
    });
    return this.organization(organizationId);
  }

  async organization(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { locations: { orderBy: { name: "asc" } } },
    });
    if (!organization)
      throw AppError.notFound("Cinema organization not found.");

    return {
      id: organization.id,
      name: organization.name,
      legalName: organization.legalName,
      businessTypeLabel: organization.businessTypeLabel,
      defaultSeatingMode: organization.defaultSeatingMode,
      timezone: organization.timezone,
      active: organization.active,
      ticketFeeMinor: organization.ticketFeeMinor,
      createdAt: organization.createdAt.toISOString(),
      payments: {
        connected: Boolean(organization.stripeConnectedAccountId),
        onboardingStatus: organization.connectOnboardingStatus,
      },
      locations: await Promise.all(
        organization.locations.map(async (location) => {
          const [
            locationAuditoriums,
            employees,
            menuItems,
            upcomingShowtimes,
            activeMovies,
            activeFilmSeries,
          ] = await Promise.all([
            prisma.auditorium.findMany({
              where: { locationId: location.id },
              orderBy: [{ active: "desc" }, { name: "asc" }],
              select: {
                id: true,
                name: true,
                capacity: true,
                seatingMode: true,
                active: true,
                seatMap: {
                  select: {
                    id: true,
                    name: true,
                    version: true,
                    layoutJson: true,
                    seats: {
                      orderBy: [{ y: "asc" }, { x: "asc" }],
                      select: {
                        id: true,
                        label: true,
                        rowLabel: true,
                        number: true,
                        x: true,
                        y: true,
                        active: true,
                        type: true,
                        tableGroupId: true,
                        tablePosition: true,
                        levelKey: true,
                        sectionKey: true,
                      },
                    },
                  },
                },
              },
            }),
            prisma.employee.count({
              where: { locationId: location.id, active: true, deletedAt: null },
            }),
            prisma.menuItem.count({
              where: {
                active: true,
                is86d: false,
                menuCategory: { locationId: location.id, active: true },
              },
            }),
            prisma.showtime.count({
              where: {
                auditorium: { locationId: location.id },
                onSale: true,
                startsAt: { gte: new Date() },
              },
            }),
            prisma.movie.count({ where: { organizationId, active: true } }),
            prisma.filmSeries.count({
              where: { organizationId, active: true },
            }),
          ]);
          return {
            id: location.id,
            name: location.name,
            address: location.address,
            timezone: location.timezone,
            currency: location.currency,
            active: location.active,
            branding: {
              logoUrl: location.customerLogoUrl,
              accentColor: location.customerAccentColor,
              accentMutedColor: location.customerAccentMutedColor,
              backgroundColor: location.customerBackgroundColor,
              backgroundGlowColor: location.customerBackgroundGlowColor,
              surfaceColor: location.customerSurfaceColor,
              textColor: location.customerTextColor,
              mutedTextColor: location.customerMutedTextColor,
            },
            adminBranding: {
              accentColor: location.adminAccentColor,
              accentMutedColor: location.adminAccentMutedColor,
              backgroundColor: location.adminBackgroundColor,
              surfaceColor: location.adminSurfaceColor,
              textColor: location.adminTextColor,
              mutedTextColor: location.adminMutedTextColor,
              ui: adminUiConfigSchema.safeParse(location.adminUiConfig).success
                ? adminUiConfigSchema.parse(location.adminUiConfig)
                : adminUiDefaults,
            },
            brandingDraft: platformBrandingDraftSchema.safeParse(
              location.brandingDraft,
            ).success
              ? {
                  values: platformBrandingDraftSchema.parse(
                    location.brandingDraft,
                  ),
                  draftedAt: location.brandingDraftedAt?.toISOString() ?? null,
                }
              : null,
            content: {
              draft: cinemaContentSchema.safeParse(location.contentDraft)
                .success
                ? cinemaContentSchema.parse(location.contentDraft)
                : cinemaContentDefaults,
              published: cinemaContentSchema.safeParse(
                location.contentPublished,
              ).success
                ? cinemaContentSchema.parse(location.contentPublished)
                : cinemaContentDefaults,
              publishedAt: location.contentPublishedAt?.toISOString() ?? null,
            },
            operations: {
              ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints,
              preShowBufferMinutes: location.preShowBufferMinutes,
              cleaningBufferMinutes: location.cleaningBufferMinutes,
              checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd,
              autoSettleGraceMinutes: location.autoSettleGraceMinutes,
              timeClockEnabled: location.timeClockEnabled,
            },
            auditoriums: locationAuditoriums.map((auditorium) => ({
              id: auditorium.id,
              name: auditorium.name,
              capacity: auditorium.capacity,
              seatingMode: auditorium.seatingMode,
              active: auditorium.active,
              seatMap: auditorium.seatMap
                ? {
                    id: auditorium.seatMap.id,
                    name: auditorium.seatMap.name,
                    version: auditorium.seatMap.version,
                    layout: auditorium.seatMap.layoutJson,
                    activeSeats: auditorium.seatMap.seats.filter(
                      (seat) => seat.active,
                    ).length,
                    accessibleSeats: auditorium.seatMap.seats.filter(
                      (seat) => seat.active && seat.type === "ADA",
                    ).length,
                    companionSeats: auditorium.seatMap.seats.filter(
                      (seat) => seat.active && seat.type === "COMPANION",
                    ).length,
                    seats: auditorium.seatMap.seats,
                  }
                : null,
            })),
            configuration: {
              auditoriums: locationAuditoriums.filter(
                (auditorium) => auditorium.active,
              ).length,
              employees,
              menuItems,
              upcomingShowtimes,
              activeMovies,
              activeFilmSeries,
            },
          };
        }),
      ),
    };
  }

  async createAuditorium(
    input: PlatformAuditoriumInput & {
      actorId: string;
      organizationId: string;
      locationId: string;
    },
  ) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!location) throw AppError.notFound("Cinema location not found.");
    const reservedSeats = input.seats ?? [];
    const layoutErrors =
      input.seatingMode === "RESERVED"
        ? input.layout
          ? validateAdvancedSeatLayout(reservedSeats, input.layout)
          : validateSeatLayout(reservedSeats)
        : [];
    if (layoutErrors.length)
      throw AppError.validationFailed("The seat layout is invalid.", {
        errors: layoutErrors,
      });

    try {
      return await prisma.$transaction(async (tx) => {
        const auditorium = await tx.auditorium.create({
          data: {
            locationId: input.locationId,
            name: input.name,
            capacity:
              input.seatingMode === "GENERAL_ADMISSION"
                ? input.capacity!
                : reservedSeats.length,
            seatingMode: input.seatingMode,
            ...(input.seatingMode === "RESERVED"
              ? {
                  seatMap: {
                    create: {
                      name: input.seatMapName!,
                      layoutJson: input.layout as
                        Prisma.InputJsonValue | undefined,
                      revisions: {
                        create: {
                          version: 1,
                          layoutJson: input.layout as
                            Prisma.InputJsonValue | undefined,
                        },
                      },
                      seats: {
                        create: reservedSeats.map((seat) => ({
                          ...seat,
                          label: seat.label.toUpperCase(),
                          rowLabel: seat.rowLabel.toUpperCase(),
                          tableGroupId: seat.tableGroupId ?? null,
                          tablePosition: seat.tablePosition ?? null,
                          levelKey: seat.levelKey ?? null,
                          sectionKey: seat.sectionKey ?? null,
                        })),
                      },
                    },
                  },
                }
              : {}),
          },
          include: { seatMap: { include: { seats: true } } },
        });
        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            locationId: input.locationId,
            action: "platform.auditorium_created",
            entityType: "Auditorium",
            entityId: auditorium.id,
            afterState: {
              organizationId: input.organizationId,
              name: auditorium.name,
              capacity: auditorium.capacity,
            },
          },
          tx,
        );
        return auditorium;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "An auditorium or seat already uses that name, label, or coordinate.",
        );
      throw error;
    }
  }

  async updateAuditorium(
    input: PlatformAuditoriumUpdateInput & {
      actorId: string;
      organizationId: string;
      locationId: string;
      auditoriumId: string;
    },
  ) {
    const reservedSeats = input.seats ?? [];
    const layoutErrors =
      input.seatingMode === "GENERAL_ADMISSION"
        ? []
        : validateAdvancedSeatLayout(reservedSeats, input.layout!);
    if (layoutErrors.length)
      throw AppError.validationFailed("The seat layout is invalid.", {
        errors: layoutErrors,
      });
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.auditoriumId}))`;
        const auditorium = await tx.auditorium.findFirst({
          where: {
            id: input.auditoriumId,
            locationId: input.locationId,
            location: { organizationId: input.organizationId },
          },
          include: { seatMap: true },
        });
        if (!auditorium) throw AppError.notFound("Auditorium not found.");
        if (input.seatingMode === "GENERAL_ADMISSION") {
          const updated = await tx.auditorium.update({
            where: { id: auditorium.id },
            data: {
              name: input.name ?? auditorium.name,
              capacity: input.capacity!,
              seatingMode: "GENERAL_ADMISSION",
            },
            include: {
              seatMap: { include: { seats: { where: { active: true } } } },
            },
          });
          await this.audit.record(
            {
              actorType: "PLATFORM",
              actorId: input.actorId,
              locationId: input.locationId,
              action: "platform.auditorium_general_admission_configured",
              entityType: "Auditorium",
              entityId: auditorium.id,
              beforeState: {
                capacity: auditorium.capacity,
                seatingMode: auditorium.seatingMode,
              },
              afterState: {
                capacity: updated.capacity,
                seatingMode: updated.seatingMode,
              },
            },
            tx,
          );
          return updated;
        }
        const seatMap =
          auditorium.seatMap ??
          (await tx.seatMap.create({
            data: {
              auditoriumId: auditorium.id,
              name:
                input.seatMapName ?? `${input.name ?? auditorium.name} layout`,
              version: 0,
            },
          }));
        const nextVersion = seatMap.version + 1;
        await tx.seat.updateMany({
          where: { seatMapId: seatMap.id, active: true },
          data: { active: false },
        });
        await tx.seatMap.update({
          where: { id: seatMap.id },
          data: {
            name: input.seatMapName ?? seatMap.name,
            version: nextVersion,
            layoutJson: input.layout as Prisma.InputJsonValue,
            revisions: {
              create: {
                version: nextVersion,
                layoutJson: input.layout as Prisma.InputJsonValue,
              },
            },
            seats: {
              create: reservedSeats.map((seat) => ({
                ...seat,
                label: seat.label.toUpperCase(),
                rowLabel: seat.rowLabel.toUpperCase(),
                layoutVersion: nextVersion,
                tableGroupId: seat.tableGroupId ?? null,
                tablePosition: seat.tablePosition ?? null,
                levelKey: seat.levelKey ?? null,
                sectionKey: seat.sectionKey ?? null,
              })),
            },
          },
        });
        const updated = await tx.auditorium.update({
          where: { id: auditorium.id },
          data: {
            name: input.name ?? auditorium.name,
            capacity: reservedSeats.length,
            seatingMode: "RESERVED",
          },
          include: {
            seatMap: {
              include: {
                seats: {
                  where: { active: true },
                  orderBy: [{ y: "asc" }, { x: "asc" }],
                },
              },
            },
          },
        });
        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            locationId: input.locationId,
            action: "platform.auditorium_updated",
            entityType: "Auditorium",
            entityId: auditorium.id,
            beforeState: {
              name: auditorium.name,
              capacity: auditorium.capacity,
              version: seatMap.version,
            },
            afterState: {
              name: updated.name,
              capacity: updated.capacity,
              version: nextVersion,
              seatingMode: updated.seatingMode,
            },
          },
          tx,
        );
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "An auditorium or seat already uses that name, label, or coordinate.",
        );
      throw error;
    }
  }

  async deleteAuditorium(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    auditoriumId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const auditorium = await tx.auditorium.findFirst({
        where: {
          id: input.auditoriumId,
          locationId: input.locationId,
          location: { organizationId: input.organizationId },
        },
      });
      if (!auditorium) throw AppError.notFound("Auditorium not found.");
      const showtimes = await tx.showtime.count({
        where: { auditoriumId: auditorium.id },
      });
      if (showtimes)
        throw AppError.conflict(
          "This auditorium has showtime or sales history and cannot be permanently deleted. Deactivate it in cinema Admin to preserve reporting records.",
        );
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: input.locationId,
          action: "platform.auditorium_deleted",
          entityType: "Auditorium",
          entityId: auditorium.id,
          beforeState: { name: auditorium.name, capacity: auditorium.capacity },
        },
        tx,
      );
      await tx.auditorium.delete({ where: { id: auditorium.id } });
      return { deleted: true, id: auditorium.id, active: false };
    });
  }

  async duplicateAuditorium(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    auditoriumId: string;
    name: string;
  }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const source = await tx.auditorium.findFirst({
          where: {
            id: input.auditoriumId,
            locationId: input.locationId,
            active: true,
            location: { organizationId: input.organizationId },
          },
          include: {
            seatMap: { include: { seats: { where: { active: true } } } },
          },
        });
        if (!source) throw AppError.notFound("Auditorium not found.");
        const copy = await tx.auditorium.create({
          data: {
            locationId: input.locationId,
            name: input.name,
            capacity: source.capacity,
            seatingMode: source.seatingMode,
            ...(source.seatingMode === "RESERVED" && source.seatMap
              ? {
                  seatMap: {
                    create: {
                      name: `${input.name} layout`,
                      version: 1,
                      layoutJson: source.seatMap.layoutJson ?? undefined,
                      revisions: {
                        create: {
                          version: 1,
                          layoutJson: source.seatMap.layoutJson ?? undefined,
                        },
                      },
                      seats: {
                        create: source.seatMap.seats.map((seat) => ({
                          label: seat.label,
                          rowLabel: seat.rowLabel,
                          number: seat.number,
                          x: seat.x,
                          y: seat.y,
                          type: seat.type,
                          tableGroupId: seat.tableGroupId,
                          tablePosition: seat.tablePosition,
                          levelKey: seat.levelKey,
                          sectionKey: seat.sectionKey,
                        })),
                      },
                    },
                  },
                }
              : {}),
          },
          include: { seatMap: { include: { seats: true } } },
        });
        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            locationId: input.locationId,
            action: "platform.auditorium_duplicated",
            entityType: "Auditorium",
            entityId: copy.id,
            afterState: {
              organizationId: input.organizationId,
              sourceAuditoriumId: source.id,
              name: copy.name,
              capacity: copy.capacity,
            },
          },
          tx,
        );
        return copy;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict("An auditorium with that name already exists.");
      throw error;
    }
  }

  async deactivateAuditorium(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    auditoriumId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const auditorium = await tx.auditorium.findFirst({
        where: {
          id: input.auditoriumId,
          locationId: input.locationId,
          active: true,
          location: { organizationId: input.organizationId },
        },
      });
      if (!auditorium) throw AppError.notFound("Auditorium not found.");
      const futureShowtimes = await tx.showtime.count({
        where: {
          auditoriumId: input.auditoriumId,
          startsAt: { gte: new Date() },
        },
      });
      if (futureShowtimes)
        throw AppError.conflict(
          `Remove or move ${futureShowtimes} future showtime${futureShowtimes === 1 ? "" : "s"} before deactivating this auditorium.`,
        );
      const deactivated = await tx.auditorium.update({
        where: { id: auditorium.id },
        data: { active: false },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: input.locationId,
          action: "platform.auditorium_deactivated",
          entityType: "Auditorium",
          entityId: auditorium.id,
          beforeState: {
            organizationId: input.organizationId,
            active: true,
            name: auditorium.name,
            capacity: auditorium.capacity,
          },
          afterState: { active: false },
        },
        tx,
      );
      return deactivated;
    });
  }

  async updateOrganization(input: {
    actorId: string;
    organizationId: string;
    name?: string;
    legalName?: string | null;
    businessTypeLabel?: string | null;
    defaultSeatingMode?: "RESERVED" | "GENERAL_ADMISSION";
    timezone?: string;
    ticketFeeMinor?: number;
    active?: boolean;
  }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!before) throw AppError.notFound("Cinema organization not found.");
      const updated = await tx.organization.update({
        where: { id: input.organizationId },
        data: {
          name: input.name,
          legalName: input.legalName,
          businessTypeLabel: input.businessTypeLabel,
          defaultSeatingMode: input.defaultSeatingMode,
          timezone: input.timezone,
          ticketFeeMinor: input.ticketFeeMinor,
          active: input.active,
        },
      });
      if (input.active === false && before.active) {
        await tx.staffAuthAccount.updateMany({
          where: {
            employee: { location: { organizationId: input.organizationId } },
          },
          data: { refreshTokenVersion: { increment: 1 } },
        });
      }
      if (input.ticketFeeMinor !== undefined)
        await tx.priceTier.updateMany({
          where: { organizationId: input.organizationId },
          data: { feeMinor: input.ticketFeeMinor },
        });
      const state = (organization: typeof updated) => ({
        name: organization.name,
        legalName: organization.legalName,
        businessTypeLabel: organization.businessTypeLabel,
        defaultSeatingMode: organization.defaultSeatingMode,
        timezone: organization.timezone,
        active: organization.active,
        onboardingStatus: organization.connectOnboardingStatus,
        ticketFeeMinor: organization.ticketFeeMinor,
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          action: "platform.organization_updated",
          entityType: "Organization",
          entityId: updated.id,
          beforeState: state(before),
          afterState: state(updated),
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  async deleteOrganization(input: { actorId: string; organizationId: string }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id: input.organizationId },
          select: {
            id: true,
            name: true,
            active: true,
            stripeConnectedAccountId: true,
            _count: {
              select: {
                roles: true,
                movies: true,
                filmSeries: true,
                priceTiers: true,
                paymentCustomers: true,
                giftCards: true,
                giftCardPurchases: true,
              },
            },
            locations: {
              select: {
                _count: {
                  select: {
                    employees: true,
                    employeeRoles: true,
                    auditoriums: true,
                    ticketTypes: true,
                    ticketOrders: true,
                    restaurantTabs: true,
                    kitchenStations: true,
                    menuCategories: true,
                    taxRules: true,
                    serviceChargeRules: true,
                    cashDrawers: true,
                    cashTransactions: true,
                    promotions: true,
                    shifts: true,
                    privateEventInquiries: true,
                    issuedGiftCards: true,
                    giftCardTransactions: true,
                    giftCardPurchases: true,
                    schedulePlans: true,
                  },
                },
              },
            },
          },
        });
        if (!organization)
          throw AppError.notFound("Cinema organization not found.");
        if (organization.active)
          throw AppError.conflict(
            "Suspend this client before permanently deleting it.",
          );
        if (organization.stripeConnectedAccountId)
          throw AppError.conflict(
            "This client has a connected payment account and cannot be permanently deleted. Keep it suspended to preserve financial records.",
          );

        const organizationRecords = Object.values(organization._count).reduce(
          (total, count) => total + count,
          0,
        );
        const locationRecords = organization.locations.reduce(
          (total, location) =>
            total +
            Object.values(location._count).reduce(
              (subtotal, count) => subtotal + count,
              0,
            ),
          0,
        );
        if (organizationRecords + locationRecords > 0) {
          throw AppError.conflict(
            "This client has configuration, operational, or financial history and cannot be permanently deleted. Keep it suspended to preserve its records.",
          );
        }

        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            action: "platform.organization_deleted",
            entityType: "Organization",
            entityId: organization.id,
            beforeState: {
              name: organization.name,
              active: organization.active,
            },
          },
          tx,
        );
        await tx.organization.delete({ where: { id: organization.id } });
        return { deleted: true, id: organization.id, name: organization.name };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw AppError.conflict(
          "This client still has linked records and cannot be permanently deleted. Keep it suspended to preserve its history.",
        );
      }
      throw error;
    }
  }

  async createConnectOnboardingLink(input: {
    actorId: string;
    organizationId: string;
    origin: string;
    returnPath: "/clients" | "/payments";
  }) {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (!organization)
      throw AppError.notFound("Cinema organization not found.");

    let accountId = organization.stripeConnectedAccountId;
    if (!accountId) {
      const account = await this.connect.createAccount({
        organizationId: organization.id,
        businessName: organization.legalName ?? organization.name,
        idempotencyKey: `connect-account:${organization.id}`,
      });
      accountId = account.id;
      await prisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: organization.id },
          data: {
            stripeConnectedAccountId: account.id,
            connectOnboardingStatus: ConnectOnboardingStatus.IN_PROGRESS,
          },
        });
        await this.audit.record(
          {
            actorType: "PLATFORM",
            actorId: input.actorId,
            action: "platform.connect_account_created",
            entityType: "Organization",
            entityId: organization.id,
            afterState: {
              accountId: account.id,
              onboardingStatus: "IN_PROGRESS",
            },
          },
          tx,
        );
      });
    }

    const organizationQuery = `organizationId=${encodeURIComponent(organization.id)}`;
    const link = await this.connect.createAccountLink({
      accountId,
      refreshUrl: `${input.origin}${input.returnPath}?${organizationQuery}&connect=refresh`,
      returnUrl: `${input.origin}${input.returnPath}?${organizationQuery}&connect=return`,
    });
    return { url: link.url };
  }

  async refreshConnectStatus(input: {
    actorId: string;
    organizationId: string;
  }) {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (!organization)
      throw AppError.notFound("Cinema organization not found.");
    if (!organization.stripeConnectedAccountId)
      throw AppError.conflict(
        "Stripe onboarding has not started for this organization.",
      );
    const account = await this.connect.retrieveAccount(
      organization.stripeConnectedAccountId,
    );
    const status = this.connectStatus(account);
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organization.id },
        data: { connectOnboardingStatus: status },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          action: "platform.connect_status_refreshed",
          entityType: "Organization",
          entityId: organization.id,
          beforeState: {
            onboardingStatus: organization.connectOnboardingStatus,
          },
          afterState: {
            onboardingStatus: status,
            chargesEnabled: account.chargesEnabled,
            payoutsEnabled: account.payoutsEnabled,
            detailsSubmitted: account.detailsSubmitted,
            currentlyDue: account.currentlyDue,
            disabledReason: account.disabledReason,
          },
        },
        tx,
      );
    });
    return this.organization(organization.id);
  }

  private connectStatus(account: ConnectAccountState): ConnectOnboardingStatus {
    if (
      account.chargesEnabled &&
      account.payoutsEnabled &&
      account.detailsSubmitted
    )
      return ConnectOnboardingStatus.COMPLETE;
    if (account.disabledReason || account.detailsSubmitted)
      return ConnectOnboardingStatus.RESTRICTED;
    return ConnectOnboardingStatus.IN_PROGRESS;
  }

  async updateLocation(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    name?: string;
    address?: string | null;
    timezone?: string;
    active?: boolean;
    logoUrl?: string | null;
    accentColor?: string | null;
    accentMutedColor?: string | null;
    backgroundColor?: string | null;
    backgroundGlowColor?: string | null;
    surfaceColor?: string | null;
    textColor?: string | null;
    mutedTextColor?: string | null;
    adminAccentColor?: string | null;
    adminAccentMutedColor?: string | null;
    adminBackgroundColor?: string | null;
    adminSurfaceColor?: string | null;
    adminTextColor?: string | null;
    adminMutedTextColor?: string | null;
    adminUi?: AdminUiConfig;
    ticketTaxRateBasisPoints?: number;
    preShowBufferMinutes?: number;
    cleaningBufferMinutes?: number;
    checkDropMinutesBeforeEnd?: number;
    autoSettleGraceMinutes?: number;
    timeClockEnabled?: boolean;
  }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!before) throw AppError.notFound("Cinema location not found.");
      const currentUi = adminUiConfigSchema.safeParse(before.adminUiConfig)
        .success
        ? adminUiConfigSchema.parse(before.adminUiConfig)
        : adminUiDefaults;
      const previousPalette = {
        savedAt: new Date().toISOString(),
        accentColor:
          before.adminAccentColor ?? adminBrandingDefaults.accentColor,
        accentMutedColor:
          before.adminAccentMutedColor ??
          adminBrandingDefaults.accentMutedColor,
        backgroundColor:
          before.adminBackgroundColor ?? adminBrandingDefaults.backgroundColor,
        surfaceColor:
          before.adminSurfaceColor ?? adminBrandingDefaults.surfaceColor,
        textColor: before.adminTextColor ?? adminBrandingDefaults.textColor,
        mutedTextColor:
          before.adminMutedTextColor ?? adminBrandingDefaults.mutedTextColor,
        onSaleColor: currentUi.onSaleColor,
        draftColor: currentUi.draftColor,
        pastColor: currentUi.pastColor,
        removeControlColor: currentUi.removeControlColor,
        duplicateControlColor: currentUi.duplicateControlColor,
      };
      const paletteChanged =
        input.adminUi &&
        [
          input.adminAccentColor,
          input.adminAccentMutedColor,
          input.adminBackgroundColor,
          input.adminSurfaceColor,
          input.adminTextColor,
          input.adminMutedTextColor,
          input.adminUi.onSaleColor,
          input.adminUi.draftColor,
          input.adminUi.pastColor,
          input.adminUi.removeControlColor,
          input.adminUi.duplicateControlColor,
        ].some(
          (color, index) =>
            color !== Object.values(previousPalette).slice(1)[index],
        );
      const nextAdminUi = input.adminUi
        ? {
            ...input.adminUi,
            colorHistory: paletteChanged
              ? [previousPalette, ...currentUi.colorHistory].slice(0, 20)
              : currentUi.colorHistory,
          }
        : undefined;
      const updated = await tx.location.update({
        where: { id: input.locationId },
        data: {
          name: input.name,
          address: input.address,
          timezone: input.timezone,
          active: input.active,
          customerLogoUrl: input.logoUrl,
          customerAccentColor: input.accentColor,
          customerAccentMutedColor: input.accentMutedColor,
          customerBackgroundColor: input.backgroundColor,
          customerBackgroundGlowColor: input.backgroundGlowColor,
          customerSurfaceColor: input.surfaceColor,
          customerTextColor: input.textColor,
          customerMutedTextColor: input.mutedTextColor,
          adminAccentColor: input.adminAccentColor,
          adminAccentMutedColor: input.adminAccentMutedColor,
          adminBackgroundColor: input.adminBackgroundColor,
          adminSurfaceColor: input.adminSurfaceColor,
          adminTextColor: input.adminTextColor,
          adminMutedTextColor: input.adminMutedTextColor,
          adminUiConfig: nextAdminUi as Prisma.InputJsonValue | undefined,
          ticketTaxRateBasisPoints: input.ticketTaxRateBasisPoints,
          preShowBufferMinutes: input.preShowBufferMinutes,
          cleaningBufferMinutes: input.cleaningBufferMinutes,
          checkDropMinutesBeforeEnd: input.checkDropMinutesBeforeEnd,
          autoSettleGraceMinutes: input.autoSettleGraceMinutes,
          timeClockEnabled: input.timeClockEnabled,
        },
      });
      const state = (location: typeof updated) => ({
        name: location.name,
        address: location.address,
        timezone: location.timezone,
        active: location.active,
        logoUrl: location.customerLogoUrl,
        accentColor: location.customerAccentColor,
        accentMutedColor: location.customerAccentMutedColor,
        backgroundColor: location.customerBackgroundColor,
        backgroundGlowColor: location.customerBackgroundGlowColor,
        surfaceColor: location.customerSurfaceColor,
        textColor: location.customerTextColor,
        mutedTextColor: location.customerMutedTextColor,
        adminAccentColor: location.adminAccentColor,
        adminAccentMutedColor: location.adminAccentMutedColor,
        adminBackgroundColor: location.adminBackgroundColor,
        adminSurfaceColor: location.adminSurfaceColor,
        adminTextColor: location.adminTextColor,
        adminMutedTextColor: location.adminMutedTextColor,
        adminUi: location.adminUiConfig,
        ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints,
        preShowBufferMinutes: location.preShowBufferMinutes,
        cleaningBufferMinutes: location.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd,
        autoSettleGraceMinutes: location.autoSettleGraceMinutes,
        timeClockEnabled: location.timeClockEnabled,
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: updated.id,
          action: "platform.location_updated",
          entityType: "Location",
          entityId: updated.id,
          beforeState: state(before),
          afterState: state(updated),
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  async updateBrandingDraft(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    branding: PlatformBrandingDraft;
  }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const previous = platformBrandingDraftSchema.safeParse(
        location.brandingDraft,
      );
      const draftedAt = new Date();
      await tx.location.update({
        where: { id: location.id },
        data: {
          brandingDraft: input.branding as Prisma.InputJsonValue,
          brandingDraftedAt: draftedAt,
        },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: location.id,
          action: "platform.branding_draft_updated",
          entityType: "Location",
          entityId: location.id,
          beforeState: previous.success ? previous.data : undefined,
          afterState: { ...input.branding, draftedAt: draftedAt.toISOString() },
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  async publishBranding(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
  }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const parsed = platformBrandingDraftSchema.safeParse(
        location.brandingDraft,
      );
      if (!parsed.success)
        throw AppError.conflict("Save a branding draft before publishing.");
      const branding = parsed.data;
      const previous = {
        logoUrl: location.customerLogoUrl,
        accentColor: location.customerAccentColor,
        accentMutedColor: location.customerAccentMutedColor,
        backgroundColor: location.customerBackgroundColor,
        backgroundGlowColor: location.customerBackgroundGlowColor,
        surfaceColor: location.customerSurfaceColor,
        textColor: location.customerTextColor,
        mutedTextColor: location.customerMutedTextColor,
        adminAccentColor: location.adminAccentColor,
        adminAccentMutedColor: location.adminAccentMutedColor,
        adminBackgroundColor: location.adminBackgroundColor,
        adminSurfaceColor: location.adminSurfaceColor,
        adminTextColor: location.adminTextColor,
        adminMutedTextColor: location.adminMutedTextColor,
        adminUi: adminUiConfigSchema.safeParse(location.adminUiConfig).success
          ? adminUiConfigSchema.parse(location.adminUiConfig)
          : adminUiDefaults,
      };
      await tx.location.update({
        where: { id: location.id },
        data: {
          customerLogoUrl: branding.logoUrl,
          customerAccentColor: branding.accentColor,
          customerAccentMutedColor: branding.accentMutedColor,
          customerBackgroundColor: branding.backgroundColor,
          customerBackgroundGlowColor: branding.backgroundGlowColor,
          customerSurfaceColor: branding.surfaceColor,
          customerTextColor: branding.textColor,
          customerMutedTextColor: branding.mutedTextColor,
          adminAccentColor: branding.adminAccentColor,
          adminAccentMutedColor: branding.adminAccentMutedColor,
          adminBackgroundColor: branding.adminBackgroundColor,
          adminSurfaceColor: branding.adminSurfaceColor,
          adminTextColor: branding.adminTextColor,
          adminMutedTextColor: branding.adminMutedTextColor,
          adminUiConfig: branding.adminUi as Prisma.InputJsonValue,
          brandingDraft: Prisma.DbNull,
          brandingDraftedAt: null,
        },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: location.id,
          action: "platform.branding_published",
          entityType: "Location",
          entityId: location.id,
          beforeState: previous,
          afterState: branding,
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  async createSupportSession(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
  }) {
    const location = await prisma.location.findFirst({
      where: {
        id: input.locationId,
        organizationId: input.organizationId,
        active: true,
        organization: { active: true },
      },
      include: { organization: { select: { name: true } } },
    });
    if (!location) throw AppError.notFound("Active cinema location not found.");
    const env = loadEnv();
    const accessToken = signTokenPair(
      {
        sub: input.actorId,
        actorType: "EMPLOYEE",
        locationId: location.id,
        permissions: Object.values(Permission),
        supportSession: true,
      },
      { sub: input.actorId, actorType: "EMPLOYEE", tokenVersion: 0 },
      {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTtlSeconds: 15 * 60,
        refreshTtlSeconds: 15 * 60,
      },
    ).accessToken;
    await this.audit.record({
      actorType: "PLATFORM",
      actorId: input.actorId,
      locationId: location.id,
      action: "platform.support_session_created",
      entityType: "Location",
      entityId: location.id,
      afterState: {
        organizationId: input.organizationId,
        organizationName: location.organization.name,
        locationName: location.name,
        readOnly: true,
        expiresInSeconds: 900,
      },
    });
    return {
      accessToken,
      expiresInSeconds: 900,
      location: { id: location.id, name: location.name },
    };
  }

  async createCinemaManager(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    name: string;
    email: string;
    password: string;
  }) {
    const normalizedEmail = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const duplicate = await tx.employee.findUnique({
        where: { email: normalizedEmail },
      });
      if (duplicate)
        throw AppError.conflict("An employee with that email already exists.");

      let role = await tx.role.findUnique({
        where: {
          organizationId_key: {
            organizationId: input.organizationId,
            key: RoleKey.CinemaManager,
          },
        },
      });
      if (!role) {
        role = await tx.role.create({
          data: {
            organizationId: input.organizationId,
            key: RoleKey.CinemaManager,
            name: "Cinema Manager",
          },
        });
      }
      // Existing clients can predate newly introduced manager permissions. Add any
      // missing defaults whenever Master provisions a manager, while preserving
      // permissions the cinema has deliberately added to the role.
      const permissionKeys = DEFAULT_ROLE_PERMISSIONS[RoleKey.CinemaManager];
      const permissions = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
      });
      if (permissions.length !== permissionKeys.length) {
        throw AppError.conflict(
          "The Cinema Manager permission catalog is incomplete. Run the database seed before creating this account.",
        );
      }
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
      const employee = await tx.employee.create({
        data: {
          locationId: input.locationId,
          name: input.name,
          email: normalizedEmail,
          authAccount: { create: { passwordHash, mustChangePassword: false } },
          employeeRoles: {
            create: { roleId: role.id, locationId: input.locationId },
          },
        },
        select: { id: true, name: true, email: true },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: input.locationId,
          action: "platform.cinema_manager_created",
          entityType: "Employee",
          entityId: employee.id,
          afterState: {
            name: employee.name,
            email: employee.email,
            role: RoleKey.CinemaManager,
            mfaRequired: false,
          },
        },
        tx,
      );
      return { ...employee, role: RoleKey.CinemaManager, mfaRequired: false };
    });
  }

  async updateContentDraft(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
    content: CinemaContent;
  }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!location) throw AppError.notFound("Cinema location not found.");
      await tx.location.update({
        where: { id: input.locationId },
        data: { contentDraft: input.content as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: input.locationId,
          action: "platform.location_content_draft_updated",
          entityType: "Location",
          entityId: input.locationId,
          afterState: { version: input.content.version },
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  async publishContent(input: {
    actorId: string;
    organizationId: string;
    locationId: string;
  }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
      });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const content = cinemaContentSchema.parse(
        location.contentDraft ?? cinemaContentDefaults,
      );
      const publishedAt = new Date();
      await tx.location.update({
        where: { id: input.locationId },
        data: {
          contentDraft: content as Prisma.InputJsonValue,
          contentPublished: content as Prisma.InputJsonValue,
          contentPublishedAt: publishedAt,
        },
      });
      await this.audit.record(
        {
          actorType: "PLATFORM",
          actorId: input.actorId,
          locationId: input.locationId,
          action: "platform.location_content_published",
          entityType: "Location",
          entityId: input.locationId,
          afterState: {
            version: content.version,
            publishedAt: publishedAt.toISOString(),
          },
        },
        tx,
      );
    });
    return this.organization(input.organizationId);
  }

  private issueTokens(
    userId: string,
    tokenVersion: number,
    role: PlatformUserRole,
  ): TokenPair {
    const env = loadEnv();
    return signTokenPair(
      {
        sub: userId,
        actorType: "PLATFORM",
        tokenVersion,
        permissions: permissionsForPlatformRole(role),
      },
      { sub: userId, actorType: "PLATFORM", tokenVersion },
      {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      },
    );
  }
}
