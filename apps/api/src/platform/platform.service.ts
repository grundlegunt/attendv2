import { Inject, Injectable } from "@nestjs/common";
import { ConnectOnboardingStatus, Prisma, prisma } from "@cinema/database";
import { DEFAULT_ROLE_PERMISSIONS, hashPassword, RoleKey, signTokenPair, TokenPair, verifyPassword } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { adminBrandingDefaults, AdminUiConfig, adminUiConfigSchema, adminUiDefaults, CinemaContent, cinemaContentDefaults, cinemaContentSchema, PlatformLoginRequest } from "@cinema/shared";
import { AppError } from "../common/app-error";
import { AuditService } from "../audit/audit.service";
import type { ConnectAccountState, ConnectOnboardingProvider } from "@cinema/payments";
import { CONNECT_ONBOARDING_PROVIDER } from "./connect-onboarding.module";

@Injectable()
export class PlatformService {
  constructor(private readonly audit: AuditService, @Inject(CONNECT_ONBOARDING_PROVIDER) private readonly connect: ConnectOnboardingProvider) {}

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
          const brandingFields = [location.customerAccentColor, location.customerBackgroundColor, location.customerBackgroundGlowColor, location.customerTextColor];
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

  async createOrganization(input: { actorId: string; name: string; legalName?: string | null; timezone: string; location: { name: string; address?: string | null; timezone: string } }) {
    const organizationId = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          legalName: input.legalName,
          timezone: input.timezone,
          locations: { create: { name: input.location.name, address: input.location.address, timezone: input.location.timezone } },
        },
        include: { locations: true },
      });
      const location = organization.locations[0];
      await this.audit.record({
        actorType: "PLATFORM",
        actorId: input.actorId,
        locationId: location?.id,
        action: "platform.organization_created",
        entityType: "Organization",
        entityId: organization.id,
        afterState: { name: organization.name, legalName: organization.legalName, timezone: organization.timezone, initialLocationId: location?.id },
      }, tx);
      return organization.id;
    });
    return this.organization(organizationId);
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
      ticketFeeMinor: organization.ticketFeeMinor,
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
            ui: adminUiConfigSchema.safeParse(location.adminUiConfig).success ? adminUiConfigSchema.parse(location.adminUiConfig) : adminUiDefaults,
          },
          content: {
            draft: cinemaContentSchema.safeParse(location.contentDraft).success ? cinemaContentSchema.parse(location.contentDraft) : cinemaContentDefaults,
            published: cinemaContentSchema.safeParse(location.contentPublished).success ? cinemaContentSchema.parse(location.contentPublished) : cinemaContentDefaults,
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
          configuration: { auditoriums, employees, menuItems, upcomingShowtimes, activeMovies, activeFilmSeries },
        };
      })),
    };
  }

  async updateOrganization(input: { actorId: string; organizationId: string; name?: string; legalName?: string | null; timezone?: string; ticketFeeMinor?: number }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!before) throw AppError.notFound("Cinema organization not found.");
      const updated = await tx.organization.update({ where: { id: input.organizationId }, data: {
        name: input.name, legalName: input.legalName, timezone: input.timezone, ticketFeeMinor: input.ticketFeeMinor,
      } });
      if (input.ticketFeeMinor !== undefined) await tx.priceTier.updateMany({ where: { organizationId: input.organizationId }, data: { feeMinor: input.ticketFeeMinor } });
      const state = (organization: typeof updated) => ({ name: organization.name, legalName: organization.legalName, timezone: organization.timezone, onboardingStatus: organization.connectOnboardingStatus, ticketFeeMinor: organization.ticketFeeMinor });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, action: "platform.organization_updated", entityType: "Organization", entityId: updated.id, beforeState: state(before), afterState: state(updated) }, tx);
    });
    return this.organization(input.organizationId);
  }

  async createConnectOnboardingLink(input: { actorId: string; organizationId: string; origin: string; returnPath: "/clients" | "/payments" }) {
    const organization = await prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw AppError.notFound("Cinema organization not found.");

    let accountId = organization.stripeConnectedAccountId;
    if (!accountId) {
      const account = await this.connect.createAccount({ organizationId: organization.id, businessName: organization.legalName ?? organization.name, idempotencyKey: `connect-account:${organization.id}` });
      accountId = account.id;
      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: organization.id }, data: { stripeConnectedAccountId: account.id, connectOnboardingStatus: ConnectOnboardingStatus.IN_PROGRESS } });
        await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, action: "platform.connect_account_created", entityType: "Organization", entityId: organization.id, afterState: { accountId: account.id, onboardingStatus: "IN_PROGRESS" } }, tx);
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

  async refreshConnectStatus(input: { actorId: string; organizationId: string }) {
    const organization = await prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw AppError.notFound("Cinema organization not found.");
    if (!organization.stripeConnectedAccountId) throw AppError.conflict("Stripe onboarding has not started for this organization.");
    const account = await this.connect.retrieveAccount(organization.stripeConnectedAccountId);
    const status = this.connectStatus(account);
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organization.id }, data: { connectOnboardingStatus: status } });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, action: "platform.connect_status_refreshed", entityType: "Organization", entityId: organization.id, beforeState: { onboardingStatus: organization.connectOnboardingStatus }, afterState: { onboardingStatus: status, chargesEnabled: account.chargesEnabled, payoutsEnabled: account.payoutsEnabled, detailsSubmitted: account.detailsSubmitted, currentlyDue: account.currentlyDue, disabledReason: account.disabledReason } }, tx);
    });
    return this.organization(organization.id);
  }

  private connectStatus(account: ConnectAccountState): ConnectOnboardingStatus {
    if (account.chargesEnabled && account.payoutsEnabled && account.detailsSubmitted) return ConnectOnboardingStatus.COMPLETE;
    if (account.disabledReason || account.detailsSubmitted) return ConnectOnboardingStatus.RESTRICTED;
    return ConnectOnboardingStatus.IN_PROGRESS;
  }

  async updateLocation(input: { actorId: string; organizationId: string; locationId: string; name?: string; address?: string | null; timezone?: string; active?: boolean; logoUrl?: string | null; accentColor?: string | null; accentMutedColor?: string | null; backgroundColor?: string | null; backgroundGlowColor?: string | null; surfaceColor?: string | null; textColor?: string | null; mutedTextColor?: string | null; adminAccentColor?: string | null; adminAccentMutedColor?: string | null; adminBackgroundColor?: string | null; adminSurfaceColor?: string | null; adminTextColor?: string | null; adminMutedTextColor?: string | null; adminUi?: AdminUiConfig; ticketTaxRateBasisPoints?: number; preShowBufferMinutes?: number; cleaningBufferMinutes?: number; checkDropMinutesBeforeEnd?: number; autoSettleGraceMinutes?: number; timeClockEnabled?: boolean }) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!before) throw AppError.notFound("Cinema location not found.");
      const currentUi = adminUiConfigSchema.safeParse(before.adminUiConfig).success ? adminUiConfigSchema.parse(before.adminUiConfig) : adminUiDefaults;
      const previousPalette = {
        savedAt: new Date().toISOString(),
        accentColor: before.adminAccentColor ?? adminBrandingDefaults.accentColor,
        accentMutedColor: before.adminAccentMutedColor ?? adminBrandingDefaults.accentMutedColor,
        backgroundColor: before.adminBackgroundColor ?? adminBrandingDefaults.backgroundColor,
        surfaceColor: before.adminSurfaceColor ?? adminBrandingDefaults.surfaceColor,
        textColor: before.adminTextColor ?? adminBrandingDefaults.textColor,
        mutedTextColor: before.adminMutedTextColor ?? adminBrandingDefaults.mutedTextColor,
        onSaleColor: currentUi.onSaleColor, draftColor: currentUi.draftColor, pastColor: currentUi.pastColor,
        removeControlColor: currentUi.removeControlColor, duplicateControlColor: currentUi.duplicateControlColor,
      };
      const paletteChanged = input.adminUi && [input.adminAccentColor, input.adminAccentMutedColor, input.adminBackgroundColor, input.adminSurfaceColor, input.adminTextColor, input.adminMutedTextColor, input.adminUi.onSaleColor, input.adminUi.draftColor, input.adminUi.pastColor, input.adminUi.removeControlColor, input.adminUi.duplicateControlColor].some((color, index) => color !== Object.values(previousPalette).slice(1)[index]);
      const nextAdminUi = input.adminUi ? { ...input.adminUi, colorHistory: paletteChanged ? [previousPalette, ...currentUi.colorHistory].slice(0, 20) : currentUi.colorHistory } : undefined;
      const updated = await tx.location.update({ where: { id: input.locationId }, data: {
        name: input.name, address: input.address, timezone: input.timezone, active: input.active,
        customerLogoUrl: input.logoUrl, customerAccentColor: input.accentColor, customerAccentMutedColor: input.accentMutedColor,
        customerBackgroundColor: input.backgroundColor, customerBackgroundGlowColor: input.backgroundGlowColor, customerSurfaceColor: input.surfaceColor, customerTextColor: input.textColor, customerMutedTextColor: input.mutedTextColor,
        adminAccentColor: input.adminAccentColor, adminAccentMutedColor: input.adminAccentMutedColor,
        adminBackgroundColor: input.adminBackgroundColor, adminSurfaceColor: input.adminSurfaceColor,
        adminTextColor: input.adminTextColor, adminMutedTextColor: input.adminMutedTextColor,
        adminUiConfig: nextAdminUi as Prisma.InputJsonValue | undefined,
        ticketTaxRateBasisPoints: input.ticketTaxRateBasisPoints, preShowBufferMinutes: input.preShowBufferMinutes, cleaningBufferMinutes: input.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: input.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: input.autoSettleGraceMinutes, timeClockEnabled: input.timeClockEnabled,
      } });
      const state = (location: typeof updated) => ({ name: location.name, address: location.address, timezone: location.timezone, active: location.active, logoUrl: location.customerLogoUrl, accentColor: location.customerAccentColor, accentMutedColor: location.customerAccentMutedColor, backgroundColor: location.customerBackgroundColor, backgroundGlowColor: location.customerBackgroundGlowColor, surfaceColor: location.customerSurfaceColor, textColor: location.customerTextColor, mutedTextColor: location.customerMutedTextColor, adminAccentColor: location.adminAccentColor, adminAccentMutedColor: location.adminAccentMutedColor, adminBackgroundColor: location.adminBackgroundColor, adminSurfaceColor: location.adminSurfaceColor, adminTextColor: location.adminTextColor, adminMutedTextColor: location.adminMutedTextColor, adminUi: location.adminUiConfig, ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints, preShowBufferMinutes: location.preShowBufferMinutes, cleaningBufferMinutes: location.cleaningBufferMinutes, checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: location.autoSettleGraceMinutes, timeClockEnabled: location.timeClockEnabled });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, locationId: updated.id, action: "platform.location_updated", entityType: "Location", entityId: updated.id, beforeState: state(before), afterState: state(updated) }, tx);
    });
    return this.organization(input.organizationId);
  }

  async createCinemaManager(input: { actorId: string; organizationId: string; locationId: string; name: string; email: string; password: string }) {
    const normalizedEmail = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const duplicate = await tx.employee.findUnique({ where: { email: normalizedEmail } });
      if (duplicate) throw AppError.conflict("An employee with that email already exists.");

      let role = await tx.role.findUnique({
        where: { organizationId_key: { organizationId: input.organizationId, key: RoleKey.CinemaManager } },
      });
      if (!role) {
        role = await tx.role.create({
          data: { organizationId: input.organizationId, key: RoleKey.CinemaManager, name: "Cinema Manager" },
        });
        const permissionKeys = DEFAULT_ROLE_PERMISSIONS[RoleKey.CinemaManager];
        const permissions = await tx.permission.findMany({ where: { key: { in: permissionKeys } } });
        if (permissions.length !== permissionKeys.length) {
          throw AppError.conflict("The Cinema Manager permission catalog is incomplete. Run the database seed before creating this account.");
        }
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role!.id, permissionId: permission.id })),
        });
      }
      const employee = await tx.employee.create({
        data: {
          locationId: input.locationId,
          name: input.name,
          email: normalizedEmail,
          authAccount: { create: { passwordHash, mustChangePassword: false } },
          employeeRoles: { create: { roleId: role.id, locationId: input.locationId } },
        },
        select: { id: true, name: true, email: true },
      });
      await this.audit.record({
        actorType: "PLATFORM",
        actorId: input.actorId,
        locationId: input.locationId,
        action: "platform.cinema_manager_created",
        entityType: "Employee",
        entityId: employee.id,
        afterState: { name: employee.name, email: employee.email, role: RoleKey.CinemaManager, mfaRequired: false },
      }, tx);
      return { ...employee, role: RoleKey.CinemaManager, mfaRequired: false };
    });
  }

  async updateContentDraft(input: { actorId: string; organizationId: string; locationId: string; content: CinemaContent }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!location) throw AppError.notFound("Cinema location not found.");
      await tx.location.update({ where: { id: input.locationId }, data: { contentDraft: input.content as Prisma.InputJsonValue } });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, locationId: input.locationId, action: "platform.location_content_draft_updated", entityType: "Location", entityId: input.locationId, afterState: { version: input.content.version } }, tx);
    });
    return this.organization(input.organizationId);
  }

  async publishContent(input: { actorId: string; organizationId: string; locationId: string }) {
    await prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!location) throw AppError.notFound("Cinema location not found.");
      const content = cinemaContentSchema.parse(location.contentDraft ?? cinemaContentDefaults);
      const publishedAt = new Date();
      await tx.location.update({ where: { id: input.locationId }, data: { contentDraft: content as Prisma.InputJsonValue, contentPublished: content as Prisma.InputJsonValue, contentPublishedAt: publishedAt } });
      await this.audit.record({ actorType: "PLATFORM", actorId: input.actorId, locationId: input.locationId, action: "platform.location_content_published", entityType: "Location", entityId: input.locationId, afterState: { version: content.version, publishedAt: publishedAt.toISOString() } }, tx);
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
