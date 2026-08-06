import { Injectable } from "@nestjs/common";
import { ConnectOnboardingStatus, prisma } from "@cinema/database";
import { signTokenPair, TokenPair, verifyPassword } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { PlatformLoginRequest } from "@cinema/shared";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class PlatformService {
  constructor(private readonly audit: AuditService) {}

  async login(input: PlatformLoginRequest) {
    const user = await prisma.platformUser.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !user.active || !(await verifyPassword(user.passwordHash, input.password))) {
      throw AppError.invalidCredentials();
    }

    const tokens = this.issueTokens(user.id, user.refreshTokenVersion);
    await this.audit.record({
      actorType: "PLATFORM",
      actorId: user.id,
      action: "platform.login",
      entityType: "PlatformUser",
      entityId: user.id,
    });
    return { tokens, user: { id: user.id, name: user.name, email: user.email } };
  }

  async overview() {
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: { locations: { orderBy: { name: "asc" } } },
    });

    return {
      generatedAt: new Date().toISOString(),
      organizations: await Promise.all(organizations.map(async (organization) => ({
        id: organization.id,
        name: organization.name,
        legalName: organization.legalName,
        timezone: organization.timezone,
        payments: {
          connected: Boolean(organization.stripeConnectedAccountId),
          onboardingStatus: organization.connectOnboardingStatus,
        },
        locations: await Promise.all(organization.locations.map(async (location) => {
          const [auditoriums, employees, menuItems, upcomingShowtimes] = await Promise.all([
            prisma.auditorium.count({ where: { locationId: location.id, active: true } }),
            prisma.employee.count({ where: { locationId: location.id, active: true, deletedAt: null } }),
            prisma.menuItem.count({ where: { active: true, is86d: false, menuCategory: { locationId: location.id, active: true } } }),
            prisma.showtime.count({ where: { auditorium: { locationId: location.id }, onSale: true, startsAt: { gte: new Date() } } }),
          ]);
          const brandingFields = [location.customerAccentColor, location.customerBackgroundColor, location.customerTextColor];
          return {
            id: location.id,
            name: location.name,
            address: location.address,
            timezone: location.timezone,
            active: location.active,
            configuration: {
              branding: brandingFields.some(Boolean) || Boolean(location.customerLogoUrl),
              auditoriums,
              employees,
              menuItems,
              upcomingShowtimes,
            },
          };
        })),
      }))),
    };
  }

  async organization(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { locations: { orderBy: { name: "asc" } } },
    });
    if (!organization) throw AppError.notFound("Cinema organization not found.");

    return {
      id: organization.id,
      name: organization.name,
      legalName: organization.legalName,
      timezone: organization.timezone,
      createdAt: organization.createdAt.toISOString(),
      payments: {
        connected: Boolean(organization.stripeConnectedAccountId),
        onboardingStatus: organization.connectOnboardingStatus,
      },
      locations: await Promise.all(organization.locations.map(async (location) => {
        const [auditoriums, employees, menuItems, upcomingShowtimes, activeMovies, activeFilmSeries] = await Promise.all([
          prisma.auditorium.count({ where: { locationId: location.id, active: true } }),
          prisma.employee.count({ where: { locationId: location.id, active: true, deletedAt: null } }),
          prisma.menuItem.count({ where: { active: true, is86d: false, menuCategory: { locationId: location.id, active: true } } }),
          prisma.showtime.count({ where: { auditorium: { locationId: location.id }, onSale: true, startsAt: { gte: new Date() } } }),
          prisma.movie.count({ where: { organizationId, active: true } }),
          prisma.filmSeries.count({ where: { organizationId, active: true } }),
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
          },
          operations: {
            ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints,
            preShowBufferMinutes: location.preShowBufferMinutes,
            cleaningBufferMinutes: location.cleaningBufferMinutes,
            checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd,
            autoSettleGraceMinutes: location.autoSettleGraceMinutes,
            timeClockEnabled: location.timeClockEnabled,
          },
          configuration: { auditoriums, employees, menuItems, upcomingShowtimes, activeMovies, activeFilmSeries },
        };
      })),
    };
  }

  async updateOrganization(input: { actorId: string; organizationId: string; name?: string; legalName?: string | null; timezone?: string; onboardingStatus?: ConnectOnboardingStatus }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!before) throw AppError.notFound("Cinema organization not found.");
      if (input.onboardingStatus === ConnectOnboardingStatus.COMPLETE && !before.stripeConnectedAccountId) {
        throw AppError.validationFailed("Payments cannot be marked complete until a Stripe connected account exists.");
      }
      const updated = await tx.organization.update({ where: { id: input.organizationId }, data: {
        name: input.name, legalName: input.legalName, timezone: input.timezone, connectOnboardingStatus: input.onboardingStatus,
      } });
      const state = (organization: typeof updated) => ({ name: organization.name, legalName: organization.legalName, timezone: organization.timezone, onboardingStatus: organization.connectOnboardingStatus });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, action: "platform.organization_updated", entityType: "Organization", entityId: updated.id, beforeState: state(before), afterState: state(updated) }, tx);
    });
    return this.organization(input.organizationId);
  }

  async updateLocation(input: { actorId: string; organizationId: string; locationId: string; name?: string; address?: string | null; timezone?: string; active?: boolean; logoUrl?: string | null; accentColor?: string | null; accentMutedColor?: string | null; backgroundColor?: string | null; surfaceColor?: string | null; textColor?: string | null; mutedTextColor?: string | null; adminAccentColor?: string | null; adminAccentMutedColor?: string | null; adminBackgroundColor?: string | null; adminSurfaceColor?: string | null; adminTextColor?: string | null; adminMutedTextColor?: string | null; ticketTaxRateBasisPoints?: number; preShowBufferMinutes?: number; cleaningBufferMinutes?: number; checkDropMinutesBeforeEnd?: number; autoSettleGraceMinutes?: number; timeClockEnabled?: boolean }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!before) throw AppError.notFound("Cinema location not found.");
      const updated = await tx.location.update({ where: { id: input.locationId }, data: {
        name: input.name, address: input.address, timezone: input.timezone, active: input.active,
        customerLogoUrl: input.logoUrl, customerAccentColor: input.accentColor, customerAccentMutedColor: input.accentMutedColor,
        customerBackgroundColor: input.backgroundColor, customerSurfaceColor: input.surfaceColor, customerTextColor: input.textColor, customerMutedTextColor: input.mutedTextColor,
        adminAccentColor: input.adminAccentColor, adminAccentMutedColor: input.adminAccentMutedColor,
        adminBackgroundColor: input.adminBackgroundColor, adminSurfaceColor: input.adminSurfaceColor,
        adminTextColor: input.adminTextColor, adminMutedTextColor: input.adminMutedTextColor,
        ticketTaxRateBasisPoints: input.ticketTaxRateBasisPoints, preShowBufferMinutes: input.preShowBufferMinutes, cleaningBufferMinutes: input.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: input.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: input.autoSettleGraceMinutes, timeClockEnabled: input.timeClockEnabled,
      } });
      const state = (location: typeof updated) => ({ name: location.name, address: location.address, timezone: location.timezone, active: location.active, logoUrl: location.customerLogoUrl, accentColor: location.customerAccentColor, accentMutedColor: location.customerAccentMutedColor, backgroundColor: location.customerBackgroundColor, surfaceColor: location.customerSurfaceColor, textColor: location.customerTextColor, mutedTextColor: location.customerMutedTextColor, adminAccentColor: location.adminAccentColor, adminAccentMutedColor: location.adminAccentMutedColor, adminBackgroundColor: location.adminBackgroundColor, adminSurfaceColor: location.adminSurfaceColor, adminTextColor: location.adminTextColor, adminMutedTextColor: location.adminMutedTextColor, ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints, preShowBufferMinutes: location.preShowBufferMinutes, cleaningBufferMinutes: location.cleaningBufferMinutes, checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: location.autoSettleGraceMinutes, timeClockEnabled: location.timeClockEnabled });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, locationId: updated.id, action: "platform.location_updated", entityType: "Location", entityId: updated.id, beforeState: state(before), afterState: state(updated) }, tx);
    });
    return this.organization(input.organizationId);
  }

  private issueTokens(userId: string, tokenVersion: number): TokenPair {
    const env = loadEnv();
    return signTokenPair(
      { sub: userId, actorType: "PLATFORM", permissions: [] },
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
