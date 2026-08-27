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
import { z } from "zod/v3";
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

export const defaultPlatformBrandSettings = {
  companyName: "Ringo",
  masterTheme: { accentColor: "#7c9cff", backgroundColor: "#0a0b0d", surfaceColor: "#13151a", textColor: "#f5f2ea", mutedTextColor: "#989faa" },
  masterSignIn: { eyebrow: "PLATFORM OPERATIONS", title: "Run every cinema from one place.", description: "Oversee clients, revenue, onboarding, payments, and access before entering a cinema workspace.", formTitle: "Company sign in", formDescription: "Use your Ringo company credentials." },
  adminSignIn: { accentColor: "#ffbf00", backgroundColor: "#080808", surfaceColor: "#1a1a1a", textColor: "#f7f4ed", mutedTextColor: "#aaa7a0", eyebrow: "RINGO ADMIN", title: "Cinema operations", description: "Programming, ticketing, restaurant, staff, and reporting tools in one secure workspace.", formEyebrow: "MANAGER ACCESS", formTitle: "Sign in", formDescription: "Use the staff credentials issued by your manager.", securityNote: "Authorized staff only · Sessions expire automatically" },
  analytics: { enabled: false, provider: "PLAUSIBLE" as const },
};

type PlatformBrandSettingsInput = typeof defaultPlatformBrandSettings;

@Injectable()
export class PlatformService {
  private readonly organizationHealthCache = new Map<
    string,
    {
      expiresAt: number;
      value: ReturnType<PlatformService["computeOrganizationHealth"]>;
    }
  >();
  private overviewHealthCache: {
    organizationKey: string;
    expiresAt: number;
    value: ReturnType<PlatformService["computeOrganizationHealthOverview"]>;
  } | null = null;

  constructor(
    private readonly audit: AuditService,
    @Inject(CONNECT_ONBOARDING_PROVIDER)
    private readonly connect: ConnectOnboardingProvider,
    private readonly reporting: ReportingService,
  ) {}

  async platformBrandSettings(): Promise<PlatformBrandSettingsInput> {
    const settings = await prisma.platformBrandSettings.findUnique({ where: { id: "platform" } });
    if (!settings) return defaultPlatformBrandSettings;
    return {
      companyName: settings.companyName,
      masterTheme: settings.masterTheme as PlatformBrandSettingsInput["masterTheme"],
      masterSignIn: settings.masterSignIn as PlatformBrandSettingsInput["masterSignIn"],
      adminSignIn: settings.adminSignIn as PlatformBrandSettingsInput["adminSignIn"],
      analytics: settings.analytics as PlatformBrandSettingsInput["analytics"],
    };
  }

  async updatePlatformBrandSettings(actorId: string, input: PlatformBrandSettingsInput) {
    const settings = await prisma.platformBrandSettings.upsert({
      where: { id: "platform" },
      create: { id: "platform", ...input },
      update: input,
    });
    await this.audit.record({ actorType: "PLATFORM", actorId, action: "platform.branding_updated", entityType: "PlatformBrandSettings", entityId: settings.id });
    return this.platformBrandSettings();
  }

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

  async filmCatalog(input: {
    query?: string;
    limit?: string;
    offset?: string;
    includeInactive?: boolean;
  }) {
    const query = input.query?.trim().slice(0, 240);
    const take = Math.max(1, Math.min(Number(input.limit) || 50, 100));
    const skip = Math.max(0, Math.min(Number(input.offset) || 0, 10_000));
    const where: Prisma.FilmCatalogEntryWhereInput = {
      ...(input.includeInactive ? {} : { active: true }),
      ...(query ? {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { director: { contains: query, mode: "insensitive" } },
          { starring: { contains: query, mode: "insensitive" } },
          { primaryDistributorName: { contains: query, mode: "insensitive" } },
          { imdbId: { equals: query, mode: "insensitive" } },
          { eidrId: { equals: query, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [entries, total, operatorMovieCount, linkedOperatorMovieCount, activeCatalogEntryCount, inactiveCatalogEntryCount] = await prisma.$transaction([
      prisma.filmCatalogEntry.findMany({
        where,
        orderBy: [{ title: "asc" }, { releaseYear: "desc" }],
        skip,
        take,
        include: { _count: { select: { operatorMovies: true } } },
      }),
      prisma.filmCatalogEntry.count({ where }),
      prisma.movie.count(),
      prisma.movie.count({ where: { catalogEntryId: { not: null } } }),
      prisma.filmCatalogEntry.count({ where: { active: true } }),
      prisma.filmCatalogEntry.count({ where: { active: false } }),
    ]);
    return {
      entries: entries.map(({ _count, ...entry }) => ({
        ...entry,
        operatorMovieCount: _count.operatorMovies,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
      total,
      limit: take,
      offset: skip,
      syncStatus: {
        operatorMovieCount,
        linkedOperatorMovieCount,
        unlinkedOperatorMovieCount: operatorMovieCount - linkedOperatorMovieCount,
        activeCatalogEntryCount,
        inactiveCatalogEntryCount,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async syncOperatorFilmCatalog(actorId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-film-catalog-sync'))`;
      const operatorMovieCount = await tx.movie.count();
      const movies = await tx.movie.findMany({
        where: { catalogEntryId: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      let createdEntries = 0;
      let linkedMovies = 0;

      for (const movie of movies) {
        let entry = await tx.filmCatalogEntry.findFirst({
          where: {
            title: { equals: movie.title.trim(), mode: "insensitive" },
            releaseYear: movie.releaseYear,
            runtimeMinutes: movie.runtimeMinutes,
          },
          orderBy: [{ verified: "desc" }, { createdAt: "asc" }],
        });
        if (!entry) {
          entry = await tx.filmCatalogEntry.create({
            data: {
              title: movie.title.trim(),
              synopsis: movie.synopsis,
              runtimeMinutes: movie.runtimeMinutes,
              rating: movie.rating,
              releaseYear: movie.releaseYear,
              director: movie.director,
              starring: movie.starring,
              posterUrl: movie.posterUrl,
              detailPosterUrl: movie.detailPosterUrl,
              trailerUrl: movie.trailerUrl,
              primaryDistributorName: movie.distributorName,
            },
          });
          createdEntries += 1;
        }
        await tx.movie.update({ where: { id: movie.id }, data: { catalogEntryId: entry.id } });
        linkedMovies += 1;
      }

      if (createdEntries || linkedMovies) {
        await this.audit.record({
          actorType: "PLATFORM",
          actorId,
          action: "platform.film_catalog_synced",
          entityType: "FilmCatalogEntry",
          entityId: "operator-libraries",
          afterState: { createdEntries, linkedMovies },
        }, tx);
      }
      const [linkedOperatorMovieCount, activeCatalogEntryCount, inactiveCatalogEntryCount] = await Promise.all([
        tx.movie.count({ where: { catalogEntryId: { not: null } } }),
        tx.filmCatalogEntry.count({ where: { active: true } }),
        tx.filmCatalogEntry.count({ where: { active: false } }),
      ]);
      return {
        createdEntries,
        linkedMovies,
        operatorMovieCount,
        linkedOperatorMovieCount,
        unlinkedOperatorMovieCount: operatorMovieCount - linkedOperatorMovieCount,
        activeCatalogEntryCount,
        inactiveCatalogEntryCount,
      };
    }, {
      // A first synchronization can match, create, and link every film in an
      // operator library. Railway's database latency can exceed Prisma's
      // five-second interactive-transaction default even for a small cinema.
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async createFilmCatalogEntry(input: {
    actorId: string;
    title: string;
    synopsis?: string | null;
    runtimeMinutes: number;
    rating?: string | null;
    releaseYear?: number | null;
    director?: string | null;
    starring?: string | null;
    posterUrl?: string | null;
    detailPosterUrl?: string | null;
    trailerUrl?: string | null;
    primaryDistributorName?: string | null;
    imdbId?: string | null;
    tmdbId?: number | null;
    eidrId?: string | null;
    verified?: boolean;
    active?: boolean;
  }) {
    const { actorId, ...data } = input;
    try {
      return await prisma.$transaction(async (tx) => {
        const entry = await tx.filmCatalogEntry.create({ data });
        await this.audit.record({
          actorType: "PLATFORM",
          actorId,
          action: "platform.film_catalog_entry_created",
          entityType: "FilmCatalogEntry",
          entityId: entry.id,
          afterState: this.filmCatalogAuditState(entry),
        }, tx);
        return { ...entry, operatorMovieCount: 0, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("A catalog film with that external identifier already exists.");
      }
      throw error;
    }
  }

  async updateFilmCatalogEntry(input: {
    actorId: string;
    entryId: string;
    title?: string;
    synopsis?: string | null;
    runtimeMinutes?: number;
    rating?: string | null;
    releaseYear?: number | null;
    director?: string | null;
    starring?: string | null;
    posterUrl?: string | null;
    detailPosterUrl?: string | null;
    trailerUrl?: string | null;
    primaryDistributorName?: string | null;
    imdbId?: string | null;
    tmdbId?: number | null;
    eidrId?: string | null;
    verified?: boolean;
    active?: boolean;
  }) {
    const { actorId, entryId, ...data } = input;
    try {
      return await prisma.$transaction(async (tx) => {
        const before = await tx.filmCatalogEntry.findUnique({ where: { id: entryId } });
        if (!before) throw AppError.notFound("Catalog film not found.");
        const entry = await tx.filmCatalogEntry.update({ where: { id: entryId }, data });
        await this.audit.record({
          actorType: "PLATFORM",
          actorId,
          action: "platform.film_catalog_entry_updated",
          entityType: "FilmCatalogEntry",
          entityId: entry.id,
          beforeState: this.filmCatalogAuditState(before),
          afterState: this.filmCatalogAuditState(entry),
        }, tx);
        const operatorMovieCount = await tx.movie.count({ where: { catalogEntryId: entry.id } });
        return { ...entry, operatorMovieCount, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("A catalog film with that external identifier already exists.");
      }
      throw error;
    }
  }

  async filmCatalogPerformance(input: { entryId: string; from?: string; to?: string }) {
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to) || (from && to && to.getTime() - from.getTime() > 366 * 86_400_000)) {
      throw AppError.validationFailed("A valid performance date range of 366 days or less is required.");
    }
    if (Boolean(from) !== Boolean(to)) throw AppError.validationFailed("Both performance range dates are required.");
    const catalog = await prisma.filmCatalogEntry.findUnique({
      where: { id: input.entryId },
      include: {
        operatorMovies: {
          select: {
            id: true,
            organization: { select: { id: true, name: true, locations: { where: { active: true }, select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!catalog) throw AppError.notFound("Catalog film not found.");
    const range = from && to ? { from, to } : undefined;
    const reports = await Promise.all(catalog.operatorMovies.flatMap((movie) => movie.organization.locations.map(async (location) => ({
      organization: { id: movie.organization.id, name: movie.organization.name },
      location,
      localMovieId: movie.id,
      report: await this.reporting.moviePerformance(location.id, movie.id, range),
    }))));
    const locations = reports.map(({ organization, location, localMovieId, report }) => ({ organization, location, localMovieId, totals: report.totals }));
    const weeklyPerformance = new Map<number, {
      theatricalWeek: number;
      firstShowtime: Date;
      lastShowtime: Date;
      showtimes: number;
      ticketsSold: number;
      capacity: number;
      ticketRevenueCents: number;
      fnbRevenueCents: number;
      distributorRevenueCents: number;
      cinemaRevenueCents: number;
      unallocatedRevenueCents: number;
    }>();
    type ProgrammingSlice = {
      key: string;
      label: string;
      showtimes: number;
      ticketsSold: number;
      capacity: number;
      ticketRevenueCents: number;
      fnbRevenueCents: number;
    };
    const daypartPerformance = new Map<string, ProgrammingSlice>();
    const weekdayPerformance = new Map<string, ProgrammingSlice>();
    const admissionTypes = new Map<string, { name: string; ticketsSold: number; ticketRevenueCents: number }>();
    const salesChannels = new Map<string, { channel: string; ticketsSold: number; ticketRevenueCents: number }>();
    const advanceSales = new Map<string, { key: string; label: string; ticketsSold: number; ticketRevenueCents: number; weightedLeadHours: number }>();
    const promotions = new Map<string, { code: string; name: string; type: string; orders: number; tickets: number; discountCents: number }>();
    const fnbItems = new Map<string, { name: string; chargeCategory: string; unitsSold: number; salesCents: number; orderAheadUnits: number; serviceUnits: number }>();
    const addProgrammingSlice = (target: Map<string, ProgrammingSlice>, slice: ProgrammingSlice) => {
      const current = target.get(slice.key) ?? { key: slice.key, label: slice.label, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0 };
      current.showtimes += slice.showtimes;
      current.ticketsSold += slice.ticketsSold;
      current.capacity += slice.capacity;
      current.ticketRevenueCents += slice.ticketRevenueCents;
      current.fnbRevenueCents += slice.fnbRevenueCents;
      target.set(slice.key, current);
    };
    for (const { report } of reports) {
      for (const week of report.weeklyPerformance) {
        const current = weeklyPerformance.get(week.theatricalWeek) ?? {
          theatricalWeek: week.theatricalWeek,
          firstShowtime: week.firstShowtime,
          lastShowtime: week.lastShowtime,
          showtimes: 0,
          ticketsSold: 0,
          capacity: 0,
          ticketRevenueCents: 0,
          fnbRevenueCents: 0,
          distributorRevenueCents: 0,
          cinemaRevenueCents: 0,
          unallocatedRevenueCents: 0,
        };
        current.firstShowtime = week.firstShowtime < current.firstShowtime ? week.firstShowtime : current.firstShowtime;
        current.lastShowtime = week.lastShowtime > current.lastShowtime ? week.lastShowtime : current.lastShowtime;
        current.showtimes += week.showtimes;
        current.ticketsSold += week.ticketsSold;
        current.capacity += week.capacity;
        current.ticketRevenueCents += week.ticketRevenueCents;
        current.fnbRevenueCents += week.fnbRevenueCents;
        current.distributorRevenueCents += week.distributorRevenueCents;
        current.cinemaRevenueCents += week.cinemaRevenueCents;
        current.unallocatedRevenueCents += week.unallocatedRevenueCents;
        weeklyPerformance.set(week.theatricalWeek, current);
      }
      for (const daypart of report.daypartPerformance) addProgrammingSlice(daypartPerformance, daypart);
      for (const weekday of report.weekdayPerformance) addProgrammingSlice(weekdayPerformance, weekday);
      for (const admission of report.admissionTypes) {
        const key = admission.name.trim().toLocaleLowerCase();
        const current = admissionTypes.get(key) ?? { name: admission.name, ticketsSold: 0, ticketRevenueCents: 0 };
        current.ticketsSold += admission.ticketsSold;
        current.ticketRevenueCents += admission.ticketRevenueCents;
        admissionTypes.set(key, current);
      }
      for (const channel of report.salesChannels) {
        const current = salesChannels.get(channel.channel) ?? { channel: channel.channel, ticketsSold: 0, ticketRevenueCents: 0 };
        current.ticketsSold += channel.ticketsSold;
        current.ticketRevenueCents += channel.ticketRevenueCents;
        salesChannels.set(channel.channel, current);
      }
      for (const bucket of report.advanceSales) {
        const current = advanceSales.get(bucket.key) ?? { key: bucket.key, label: bucket.label, ticketsSold: 0, ticketRevenueCents: 0, weightedLeadHours: 0 };
        current.ticketsSold += bucket.ticketsSold;
        current.ticketRevenueCents += bucket.ticketRevenueCents;
        current.weightedLeadHours += bucket.averageLeadHours * bucket.ticketsSold;
        advanceSales.set(bucket.key, current);
      }
      for (const promotion of report.promotions) {
        const key = promotion.code.trim().toLocaleLowerCase();
        const current = promotions.get(key) ?? { code: promotion.code, name: promotion.name, type: promotion.type, orders: 0, tickets: 0, discountCents: 0 };
        current.orders += promotion.orders;
        current.tickets += promotion.tickets;
        current.discountCents += promotion.discountCents;
        promotions.set(key, current);
      }
      for (const item of report.fnbItems) {
        const key = `${item.chargeCategory}:${item.name.trim().toLocaleLowerCase()}`;
        const current = fnbItems.get(key) ?? { name: item.name, chargeCategory: item.chargeCategory, unitsSold: 0, salesCents: 0, orderAheadUnits: 0, serviceUnits: 0 };
        current.unitsSold += item.unitsSold;
        current.salesCents += item.salesCents;
        current.orderAheadUnits += item.orderAheadUnits;
        current.serviceUnits += item.serviceUnits;
        fnbItems.set(key, current);
      }
    }
    const finishProgrammingSlice = (slice: ProgrammingSlice) => ({
      ...slice,
      attendancePercent: slice.capacity ? Math.round((slice.ticketsSold / slice.capacity) * 1000) / 10 : 0,
      averageTicketsPerShow: slice.showtimes ? Math.round((slice.ticketsSold / slice.showtimes) * 10) / 10 : 0,
      averageTicketRevenuePerShowCents: slice.showtimes ? Math.round(slice.ticketRevenueCents / slice.showtimes) : 0,
      averageFnbPerShowCents: slice.showtimes ? Math.round(slice.fnbRevenueCents / slice.showtimes) : 0,
    });
    const totals = locations.reduce((sum, row) => {
      sum.showtimes += row.totals.showtimes;
      sum.upcomingShowtimes += row.totals.upcomingShowtimes;
      sum.pastShowtimes += row.totals.pastShowtimes;
      sum.ticketsSold += row.totals.ticketsSold;
      sum.totalCapacity += row.totals.totalCapacity;
      sum.ticketRevenueCents += row.totals.ticketRevenueCents;
      sum.fnbRevenueCents += row.totals.fnbRevenueCents;
      sum.distributorRevenueCents += row.totals.distributorRevenueCents;
      sum.cinemaRevenueCents += row.totals.cinemaRevenueCents;
      sum.unallocatedRevenueCents += row.totals.unallocatedRevenueCents;
      sum.discountCents += row.totals.discountCents;
      sum.complimentaryTickets += row.totals.complimentaryTickets;
      sum.refundedTickets += row.totals.refundedTickets;
      sum.refundedTicketValueCents += row.totals.refundedTicketValueCents;
      return sum;
    }, { showtimes: 0, upcomingShowtimes: 0, pastShowtimes: 0, ticketsSold: 0, totalCapacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0, discountCents: 0, complimentaryTickets: 0, refundedTickets: 0, refundedTicketValueCents: 0 });
    return {
      film: {
        id: catalog.id, title: catalog.title, synopsis: catalog.synopsis, runtimeMinutes: catalog.runtimeMinutes, rating: catalog.rating,
        releaseYear: catalog.releaseYear, director: catalog.director, starring: catalog.starring, posterUrl: catalog.posterUrl,
        primaryDistributorName: catalog.primaryDistributorName, imdbId: catalog.imdbId, tmdbId: catalog.tmdbId, eidrId: catalog.eidrId,
        verified: catalog.verified, active: catalog.active,
      },
      range: range ? { from: from!.toISOString(), to: to!.toISOString() } : null,
      totals: {
        ...totals,
        attendancePercent: totals.totalCapacity ? Math.round((totals.ticketsSold / totals.totalCapacity) * 1000) / 10 : 0,
        averageTicketsPerShow: totals.showtimes ? Math.round((totals.ticketsSold / totals.showtimes) * 10) / 10 : 0,
        averageFnbPerShowCents: totals.showtimes ? Math.round(totals.fnbRevenueCents / totals.showtimes) : 0,
        averageFnbPerTicketCents: totals.ticketsSold ? Math.round(totals.fnbRevenueCents / totals.ticketsSold) : 0,
      },
      weeklyPerformance: [...weeklyPerformance.values()]
        .sort((left, right) => left.theatricalWeek - right.theatricalWeek)
        .map((week) => ({
          ...week,
          attendancePercent: week.capacity ? Math.round((week.ticketsSold / week.capacity) * 1000) / 10 : 0,
          averageTicketsPerShow: week.showtimes ? Math.round((week.ticketsSold / week.showtimes) * 10) / 10 : 0,
          averageFnbPerShowCents: week.showtimes ? Math.round(week.fnbRevenueCents / week.showtimes) : 0,
        })),
      daypartPerformance: [...daypartPerformance.values()]
        .map(finishProgrammingSlice)
        .sort((left, right) => ["MORNING", "AFTERNOON", "EVENING"].indexOf(left.key) - ["MORNING", "AFTERNOON", "EVENING"].indexOf(right.key)),
      weekdayPerformance: [...weekdayPerformance.values()]
        .map(finishProgrammingSlice)
        .sort((left, right) => ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(left.key) - ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(right.key)),
      admissionTypes: [...admissionTypes.values()]
        .map((admission) => ({ ...admission, percentOfTickets: totals.ticketsSold ? Math.round((admission.ticketsSold / totals.ticketsSold) * 1000) / 10 : 0 }))
        .sort((left, right) => right.ticketsSold - left.ticketsSold || left.name.localeCompare(right.name)),
      salesChannels: [...salesChannels.values()]
        .map((channel) => ({ ...channel, percentOfTickets: totals.ticketsSold ? Math.round((channel.ticketsSold / totals.ticketsSold) * 1000) / 10 : 0 }))
        .sort((left, right) => right.ticketsSold - left.ticketsSold || left.channel.localeCompare(right.channel)),
      advanceSales: [...advanceSales.values()]
        .map(({ weightedLeadHours, ...bucket }) => ({
          ...bucket,
          percentOfTickets: totals.ticketsSold ? Math.round((bucket.ticketsSold / totals.ticketsSold) * 1000) / 10 : 0,
          averageLeadHours: bucket.ticketsSold ? Math.round(weightedLeadHours / bucket.ticketsSold) : 0,
        }))
        .sort((left, right) => right.averageLeadHours - left.averageLeadHours),
      promotions: [...promotions.values()].sort((left, right) => right.discountCents - left.discountCents || right.tickets - left.tickets || left.code.localeCompare(right.code)),
      fnbItems: [...fnbItems.values()].sort((left, right) => right.salesCents - left.salesCents || right.unitsSold - left.unitsSold || left.name.localeCompare(right.name)),
      operators: locations.sort((left, right) => right.totals.ticketRevenueCents - left.totals.ticketRevenueCents || left.organization.name.localeCompare(right.organization.name) || left.location.name.localeCompare(right.location.name)),
    };
  }

  async distributorPortfolio(input: { from?: string; to?: string } = {}) {
    const now = new Date();
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to) || (from && to && to.getTime() - from.getTime() > 366 * 86_400_000)) {
      throw AppError.validationFailed("A valid distributor performance date range of 366 days or less is required.");
    }
    if (Boolean(from) !== Boolean(to)) throw AppError.validationFailed("Both distributor performance range dates are required.");
    const range = from && to ? { from, to } : null;
    const movies = await prisma.movie.findMany({
      where: { distributorName: { not: null } },
      orderBy: [{ distributorName: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        distributorName: true,
        distributorTerms: true,
        catalogEntryId: true,
        organization: { select: { id: true, name: true } },
        showtimes: {
          select: {
            id: true,
            startsAt: true,
            auditorium: { select: { location: { select: { id: true, name: true } } } },
            showtimeSeats: { select: { tickets: {
              where: { status: { notIn: ["REFUNDED", "CANCELED"] } },
              select: { priceCentsPaid: true },
            } } },
          },
        },
      },
    });
    const grouped = new Map<string, {
      name: string;
      operators: Set<string>;
      locations: Set<string>;
      films: Set<string>;
      shows: number;
      upcomingShows: number;
      ticketsSold: number;
      ticketFaceValueCents: number;
      distributorRevenueCents: number;
      cinemaRevenueCents: number;
      unallocatedRevenueCents: number;
      deals: Array<{ movieId: string; catalogEntryId: string | null; title: string; organization: { id: string; name: string }; locations: string[]; status: "UPCOMING" | "PAST" | "UNSCHEDULED"; showtimes: number; ticketsSold: number; ticketFaceValueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; terms: Prisma.JsonValue | null }>;
    }>();
    for (const movie of movies) {
      const name = movie.distributorName?.trim();
      if (!name) continue;
      const reportingShowtimes = range ? movie.showtimes.filter((showtime) => showtime.startsAt >= range.from && showtime.startsAt < range.to) : movie.showtimes;
      if (range && reportingShowtimes.length === 0) continue;
      const key = name.toLocaleLowerCase();
      let distributor = grouped.get(key);
      if (!distributor) {
        distributor = { name, operators: new Set(), locations: new Set(), films: new Set(), shows: 0, upcomingShows: 0, ticketsSold: 0, ticketFaceValueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0, deals: [] };
        grouped.set(key, distributor);
      }
      const locations = [...new Map(reportingShowtimes.map((showtime) => [showtime.auditorium.location.id, showtime.auditorium.location.name])).values()];
      const upcomingShows = reportingShowtimes.filter((showtime) => showtime.startsAt >= now).length;
      const tickets = reportingShowtimes.flatMap((showtime) => showtime.showtimeSeats.flatMap((seat) => seat.tickets));
      const ticketFaceValueCents = tickets.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
      const openingStartsAt = movie.showtimes.reduce<Date | null>((opening, showtime) => !opening || showtime.startsAt < opening ? showtime.startsAt : opening, null);
      const allocation = reportingShowtimes.reduce((totals, showtime) => {
        const showtimeRevenueCents = showtime.showtimeSeats.flatMap((seat) => seat.tickets).reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
        const result = this.reporting.allocateDistributorShare(showtimeRevenueCents, showtime.startsAt, openingStartsAt, movie.distributorTerms);
        totals.distributorRevenueCents += result.distributorRevenueCents;
        totals.cinemaRevenueCents += result.cinemaRevenueCents;
        totals.unallocatedRevenueCents += result.unallocatedRevenueCents;
        return totals;
      }, { distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0 });
      distributor.operators.add(movie.organization.id);
      for (const showtime of reportingShowtimes) distributor.locations.add(showtime.auditorium.location.id);
      distributor.films.add(movie.catalogEntryId ?? movie.id);
      distributor.shows += reportingShowtimes.length;
      distributor.upcomingShows += upcomingShows;
      distributor.ticketsSold += tickets.length;
      distributor.ticketFaceValueCents += ticketFaceValueCents;
      distributor.distributorRevenueCents += allocation.distributorRevenueCents;
      distributor.cinemaRevenueCents += allocation.cinemaRevenueCents;
      distributor.unallocatedRevenueCents += allocation.unallocatedRevenueCents;
      distributor.deals.push({
        movieId: movie.id,
        catalogEntryId: movie.catalogEntryId,
        title: movie.title,
        organization: movie.organization,
        locations,
        status: upcomingShows > 0 ? "UPCOMING" : reportingShowtimes.length > 0 ? "PAST" : "UNSCHEDULED",
        showtimes: reportingShowtimes.length,
        ticketsSold: tickets.length,
        ticketFaceValueCents,
        ...allocation,
        terms: movie.distributorTerms,
      });
    }
    return {
      generatedAt: now.toISOString(),
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,
      distributors: [...grouped.values()].map((distributor) => ({
        name: distributor.name,
        operators: distributor.operators.size,
        locations: distributor.locations.size,
        films: distributor.films.size,
        shows: distributor.shows,
        upcomingShows: distributor.upcomingShows,
        ticketsSold: distributor.ticketsSold,
        ticketFaceValueCents: distributor.ticketFaceValueCents,
        distributorRevenueCents: distributor.distributorRevenueCents,
        cinemaRevenueCents: distributor.cinemaRevenueCents,
        unallocatedRevenueCents: distributor.unallocatedRevenueCents,
        deals: distributor.deals.sort((left, right) => (left.status === "UPCOMING" ? -1 : 1) - (right.status === "UPCOMING" ? -1 : 1) || right.ticketFaceValueCents - left.ticketFaceValueCents),
      })).sort((left, right) => right.ticketFaceValueCents - left.ticketFaceValueCents || left.name.localeCompare(right.name)),
    };
  }

  distributorPortfolioCsv(portfolio: Awaited<ReturnType<PlatformService["distributorPortfolio"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    const columns = ["Distributor", "Film", "Operator", "Locations", "Engagement status", "Shows", "Tickets sold", "Ticket face value (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated (cents)", "Deal terms (JSON)"];
    return [
      row(["Generated at", portfolio.generatedAt]),
      "",
      row(columns),
      ...portfolio.distributors.flatMap((distributor) => distributor.deals.map((deal) => row([
        distributor.name, deal.title, deal.organization.name, deal.locations.join("; "), deal.status,
        deal.showtimes, deal.ticketsSold, deal.ticketFaceValueCents, deal.distributorRevenueCents,
        deal.cinemaRevenueCents, deal.unallocatedRevenueCents, Array.isArray(deal.terms) && deal.terms.length ? JSON.stringify(deal.terms) : "MISSING",
      ]))),
    ].join("\n");
  }

  private filmCatalogAuditState(entry: {
    title: string;
    synopsis: string | null;
    runtimeMinutes: number;
    rating: string | null;
    releaseYear: number | null;
    director: string | null;
    starring: string | null;
    posterUrl: string | null;
    detailPosterUrl: string | null;
    trailerUrl: string | null;
    primaryDistributorName: string | null;
    imdbId: string | null;
    tmdbId: number | null;
    eidrId: string | null;
    verified: boolean;
    active: boolean;
  }) {
    return {
      title: entry.title,
      synopsis: entry.synopsis,
      runtimeMinutes: entry.runtimeMinutes,
      rating: entry.rating,
      releaseYear: entry.releaseYear,
      director: entry.director,
      starring: entry.starring,
      posterUrl: entry.posterUrl,
      detailPosterUrl: entry.detailPosterUrl,
      trailerUrl: entry.trailerUrl,
      primaryDistributorName: entry.primaryDistributorName,
      imdbId: entry.imdbId,
      tmdbId: entry.tmdbId,
      eidrId: entry.eidrId,
      verified: entry.verified,
      active: entry.active,
    };
  }

  async refreshSession(refreshToken: string) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken, loadEnv().JWT_REFRESH_SECRET);
    } catch (error) {
      if (error instanceof InvalidTokenError)
        throw AppError.unauthenticated(
          "The Ringo Master session expired. Please sign in again.",
        );
      throw error;
    }
    if (payload.actorType !== "PLATFORM") throw AppError.unauthenticated();
    const user = await prisma.platformUser.findUnique({
      where: { id: payload.sub },
    });
    if (!user?.active || user.refreshTokenVersion !== payload.tokenVersion) {
      throw AppError.unauthenticated(
        "The Ringo Master session is no longer valid. Please sign in again.",
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

  private organizationHealth(
    organizationId: string,
    now = new Date(),
    forceRefresh = false,
  ) {
    const cached = this.organizationHealthCache.get(organizationId);
    if (!forceRefresh && cached && cached.expiresAt > now.getTime()) {
      return cached.value;
    }

    const value = this.computeOrganizationHealth(organizationId, now).catch(
      (error) => {
        if (this.organizationHealthCache.get(organizationId)?.value === value) {
          this.organizationHealthCache.delete(organizationId);
        }
        throw error;
      },
    );
    this.organizationHealthCache.set(organizationId, {
      expiresAt: now.getTime() + 15_000,
      value,
    });
    return value;
  }

  private async computeOrganizationHealth(
    organizationId: string,
    now = new Date(),
  ) {
    const activitySince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const currentWeekSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousWeekSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
    const paymentScope: Prisma.PaymentWhereInput = {
      OR: [
        { ticketOrder: { location: { organizationId } } },
        { restaurantTab: { location: { organizationId } } },
        { giftCardPurchase: { organizationId } },
      ],
    };
    const [failedPayments24h, processingPayments, verificationReviews, failedRefunds, lastSuccessfulPayment, stalePayments, staleRefunds, managerReviewTabs, expiredHoldBacklog, currentPaymentAttempts, currentFailedPaymentAttempts, previousPaymentAttempts, previousFailedPaymentAttempts, currentCapturedPayments, previousCapturedPayments, currentRefunds, previousRefunds] = await Promise.all([
      prisma.payment.count({ where: { AND: [paymentScope, { status: "FAILED", updatedAt: { gte: activitySince } }] } }),
      prisma.payment.count({ where: { AND: [paymentScope, { status: "PROCESSING" }] } }),
      prisma.payment.count({ where: { AND: [paymentScope, { verificationFailedAt: { not: null } }] } }),
      prisma.refund.count({ where: { status: "FAILED", payment: paymentScope } }),
      prisma.payment.findFirst({ where: { AND: [paymentScope, { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } }] }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.payment.count({ where: { AND: [paymentScope, { status: { in: ["PROCESSING", "AUTHORIZED"] }, updatedAt: { lt: staleBefore } }] } }),
      prisma.refund.count({ where: { status: { in: ["CREATED", "PROCESSING"] }, updatedAt: { lt: staleBefore }, payment: paymentScope } }),
      prisma.restaurantTab.count({ where: { location: { organizationId }, status: "MANAGER_REVIEW" } }),
      prisma.seatHold.count({ where: { releasedAt: null, expiresAt: { lt: now }, showtimeSeat: { showtime: { auditorium: { location: { organizationId } } } } } }),
      prisma.paymentAttempt.count({ where: { payment: paymentScope, attemptedAt: { gte: currentWeekSince, lt: now } } }),
      prisma.paymentAttempt.count({ where: { payment: paymentScope, status: "FAILED", attemptedAt: { gte: currentWeekSince, lt: now } } }),
      prisma.paymentAttempt.count({ where: { payment: paymentScope, attemptedAt: { gte: previousWeekSince, lt: currentWeekSince } } }),
      prisma.paymentAttempt.count({ where: { payment: paymentScope, status: "FAILED", attemptedAt: { gte: previousWeekSince, lt: currentWeekSince } } }),
      prisma.payment.aggregate({ where: { AND: [paymentScope, { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: currentWeekSince, lt: now } }] }, _sum: { amountCents: true } }),
      prisma.payment.aggregate({ where: { AND: [paymentScope, { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: previousWeekSince, lt: currentWeekSince } }] }, _sum: { amountCents: true } }),
      prisma.refund.aggregate({ where: { payment: paymentScope, status: "SUCCEEDED", updatedAt: { gte: currentWeekSince, lt: now } }, _sum: { amountCents: true } }),
      prisma.refund.aggregate({ where: { payment: paymentScope, status: "SUCCEEDED", updatedAt: { gte: previousWeekSince, lt: currentWeekSince } }, _sum: { amountCents: true } }),
    ]);
    const rate = (numerator: number, denominator: number) => denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
    const currentCapturedCents = currentCapturedPayments._sum.amountCents ?? 0;
    const previousCapturedCents = previousCapturedPayments._sum.amountCents ?? 0;
    const currentRefundedCents = currentRefunds._sum.amountCents ?? 0;
    const previousRefundedCents = previousRefunds._sum.amountCents ?? 0;
    return { failedPayments24h, processingPayments, verificationReviews, failedRefunds, stalePayments, staleRefunds, managerReviewTabs, expiredHoldBacklog, lastSuccessfulPaymentAt: lastSuccessfulPayment?.updatedAt.toISOString() ?? null, trends: {
      paymentFailure: {
        current: { failed: currentFailedPaymentAttempts, total: currentPaymentAttempts, ratePercent: rate(currentFailedPaymentAttempts, currentPaymentAttempts) },
        previous: { failed: previousFailedPaymentAttempts, total: previousPaymentAttempts, ratePercent: rate(previousFailedPaymentAttempts, previousPaymentAttempts) },
      },
      refunds: {
        current: { refundedCents: currentRefundedCents, capturedCents: currentCapturedCents, ratePercent: rate(currentRefundedCents, currentCapturedCents) },
        previous: { refundedCents: previousRefundedCents, capturedCents: previousCapturedCents, ratePercent: rate(previousRefundedCents, previousCapturedCents) },
      },
    } };
  }

  private async organizationHealthOverview(
    organizationIds: string[],
    now: Date,
    forceRefresh = false,
  ) {
    const organizationKey = [...organizationIds].sort().join(":");
    if (
      !forceRefresh &&
      this.overviewHealthCache?.organizationKey === organizationKey &&
      this.overviewHealthCache.expiresAt > now.getTime()
    ) {
      return this.overviewHealthCache.value;
    }
    const value = this.computeOrganizationHealthOverview(
      organizationIds,
      now,
    ).catch((error) => {
      if (this.overviewHealthCache?.value === value) {
        this.overviewHealthCache = null;
      }
      throw error;
    });
    this.overviewHealthCache = {
      organizationKey,
      expiresAt: now.getTime() + 15_000,
      value,
    };
    return value;
  }

  private async computeOrganizationHealthOverview(
    organizationIds: string[],
    now: Date,
  ): Promise<
    Map<
      string,
      Awaited<ReturnType<PlatformService["computeOrganizationHealth"]>>
    >
  > {
    if (organizationIds.length === 0) return new Map();
    const activitySince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const currentWeekSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousWeekSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
    type PaymentRow = {
      organizationId: string;
      failedPayments24h: bigint;
      processingPayments: bigint;
      verificationReviews: bigint;
      stalePayments: bigint;
      lastSuccessfulPaymentAt: Date | null;
      currentCapturedCents: bigint;
      previousCapturedCents: bigint;
    };
    type AttemptRow = {
      organizationId: string;
      currentPaymentAttempts: bigint;
      currentFailedPaymentAttempts: bigint;
      previousPaymentAttempts: bigint;
      previousFailedPaymentAttempts: bigint;
    };
    type RefundRow = {
      organizationId: string;
      failedRefunds: bigint;
      staleRefunds: bigint;
      currentRefundedCents: bigint;
      previousRefundedCents: bigint;
    };
    type CountRow = { organizationId: string; count: bigint };
    const paymentOrganizationCte = Prisma.sql`
      SELECT p.*,
        COALESCE(ticket_location."organizationId", tab_location."organizationId", purchase."organizationId") AS "organizationId"
      FROM payments p
      LEFT JOIN ticket_orders ticket_order ON ticket_order.id = p."ticketOrderId"
      LEFT JOIN locations ticket_location ON ticket_location.id = ticket_order."locationId"
      LEFT JOIN restaurant_tabs tab ON tab.id = p."restaurantTabId"
      LEFT JOIN locations tab_location ON tab_location.id = tab."locationId"
      LEFT JOIN gift_card_purchases purchase ON purchase."paymentId" = p.id
    `;
    const organizationFilter = Prisma.sql`ARRAY[${Prisma.join(
      organizationIds,
    )}]::text[]`;
    const [payments, attempts, refunds, reviewTabs, expiredHolds] =
      await Promise.all([
        prisma.$queryRaw<PaymentRow[]>(Prisma.sql`
          WITH payment_organizations AS (${paymentOrganizationCte})
          SELECT "organizationId",
            COUNT(*) FILTER (WHERE status::text = 'FAILED' AND "updatedAt" >= ${activitySince}) AS "failedPayments24h",
            COUNT(*) FILTER (WHERE status::text = 'PROCESSING') AS "processingPayments",
            COUNT(*) FILTER (WHERE "verificationFailedAt" IS NOT NULL) AS "verificationReviews",
            COUNT(*) FILTER (WHERE status::text IN ('PROCESSING', 'AUTHORIZED') AND "updatedAt" < ${staleBefore}) AS "stalePayments",
            MAX("updatedAt") FILTER (WHERE status::text IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')) AS "lastSuccessfulPaymentAt",
            COALESCE(SUM("amountCents") FILTER (WHERE status::text IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND "createdAt" >= ${currentWeekSince} AND "createdAt" < ${now}), 0) AS "currentCapturedCents",
            COALESCE(SUM("amountCents") FILTER (WHERE status::text IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND "createdAt" >= ${previousWeekSince} AND "createdAt" < ${currentWeekSince}), 0) AS "previousCapturedCents"
          FROM payment_organizations
          WHERE "organizationId" = ANY(${organizationFilter})
          GROUP BY "organizationId"
        `),
        prisma.$queryRaw<AttemptRow[]>(Prisma.sql`
          WITH payment_organizations AS (${paymentOrganizationCte})
          SELECT payment."organizationId",
            COUNT(*) FILTER (WHERE attempt."attemptedAt" >= ${currentWeekSince} AND attempt."attemptedAt" < ${now}) AS "currentPaymentAttempts",
            COUNT(*) FILTER (WHERE attempt.status::text = 'FAILED' AND attempt."attemptedAt" >= ${currentWeekSince} AND attempt."attemptedAt" < ${now}) AS "currentFailedPaymentAttempts",
            COUNT(*) FILTER (WHERE attempt."attemptedAt" >= ${previousWeekSince} AND attempt."attemptedAt" < ${currentWeekSince}) AS "previousPaymentAttempts",
            COUNT(*) FILTER (WHERE attempt.status::text = 'FAILED' AND attempt."attemptedAt" >= ${previousWeekSince} AND attempt."attemptedAt" < ${currentWeekSince}) AS "previousFailedPaymentAttempts"
          FROM payment_attempts attempt
          JOIN payment_organizations payment ON payment.id = attempt."paymentId"
          WHERE payment."organizationId" = ANY(${organizationFilter})
          GROUP BY payment."organizationId"
        `),
        prisma.$queryRaw<RefundRow[]>(Prisma.sql`
          WITH payment_organizations AS (${paymentOrganizationCte})
          SELECT payment."organizationId",
            COUNT(*) FILTER (WHERE refund.status::text = 'FAILED') AS "failedRefunds",
            COUNT(*) FILTER (WHERE refund.status::text IN ('CREATED', 'PROCESSING') AND refund."updatedAt" < ${staleBefore}) AS "staleRefunds",
            COALESCE(SUM(refund."amountCents") FILTER (WHERE refund.status::text = 'SUCCEEDED' AND refund."updatedAt" >= ${currentWeekSince} AND refund."updatedAt" < ${now}), 0) AS "currentRefundedCents",
            COALESCE(SUM(refund."amountCents") FILTER (WHERE refund.status::text = 'SUCCEEDED' AND refund."updatedAt" >= ${previousWeekSince} AND refund."updatedAt" < ${currentWeekSince}), 0) AS "previousRefundedCents"
          FROM refunds refund
          JOIN payment_organizations payment ON payment.id = refund."paymentId"
          WHERE payment."organizationId" = ANY(${organizationFilter})
          GROUP BY payment."organizationId"
        `),
        prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT location."organizationId", COUNT(*) AS count
          FROM restaurant_tabs tab
          JOIN locations location ON location.id = tab."locationId"
          WHERE location."organizationId" = ANY(${organizationFilter})
            AND tab.status::text = 'MANAGER_REVIEW'
          GROUP BY location."organizationId"
        `),
        prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT location."organizationId", COUNT(*) AS count
          FROM seat_holds hold
          JOIN showtime_seats inventory ON inventory.id = hold."showtimeSeatId"
          JOIN showtimes showtime ON showtime.id = inventory."showtimeId"
          JOIN auditoriums auditorium ON auditorium.id = showtime."auditoriumId"
          JOIN locations location ON location.id = auditorium."locationId"
          WHERE location."organizationId" = ANY(${organizationFilter})
            AND hold."releasedAt" IS NULL AND hold."expiresAt" < ${now}
          GROUP BY location."organizationId"
        `),
      ]);
    const byId = <T extends { organizationId: string }>(rows: T[]) =>
      new Map(rows.map((row) => [row.organizationId, row]));
    const paymentById = byId(payments);
    const attemptById = byId(attempts);
    const refundById = byId(refunds);
    const tabsById = byId(reviewTabs);
    const holdsById = byId(expiredHolds);
    const rate = (numerator: number, denominator: number) =>
      denominator > 0
        ? Math.round((numerator / denominator) * 10_000) / 100
        : null;
    return new Map(
      organizationIds.map((organizationId) => {
        const payment = paymentById.get(organizationId);
        const attempt = attemptById.get(organizationId);
        const refund = refundById.get(organizationId);
        const number = (value: bigint | undefined) => Number(value ?? 0n);
        const currentPaymentAttempts = number(attempt?.currentPaymentAttempts);
        const currentFailedPaymentAttempts = number(
          attempt?.currentFailedPaymentAttempts,
        );
        const previousPaymentAttempts = number(
          attempt?.previousPaymentAttempts,
        );
        const previousFailedPaymentAttempts = number(
          attempt?.previousFailedPaymentAttempts,
        );
        const currentCapturedCents = number(payment?.currentCapturedCents);
        const previousCapturedCents = number(payment?.previousCapturedCents);
        const currentRefundedCents = number(refund?.currentRefundedCents);
        const previousRefundedCents = number(refund?.previousRefundedCents);
        return [
          organizationId,
          {
            failedPayments24h: number(payment?.failedPayments24h),
            processingPayments: number(payment?.processingPayments),
            verificationReviews: number(payment?.verificationReviews),
            failedRefunds: number(refund?.failedRefunds),
            stalePayments: number(payment?.stalePayments),
            staleRefunds: number(refund?.staleRefunds),
            managerReviewTabs: number(tabsById.get(organizationId)?.count),
            expiredHoldBacklog: number(holdsById.get(organizationId)?.count),
            lastSuccessfulPaymentAt:
              payment?.lastSuccessfulPaymentAt?.toISOString() ?? null,
            trends: {
              paymentFailure: {
                current: {
                  failed: currentFailedPaymentAttempts,
                  total: currentPaymentAttempts,
                  ratePercent: rate(
                    currentFailedPaymentAttempts,
                    currentPaymentAttempts,
                  ),
                },
                previous: {
                  failed: previousFailedPaymentAttempts,
                  total: previousPaymentAttempts,
                  ratePercent: rate(
                    previousFailedPaymentAttempts,
                    previousPaymentAttempts,
                  ),
                },
              },
              refunds: {
                current: {
                  refundedCents: currentRefundedCents,
                  capturedCents: currentCapturedCents,
                  ratePercent: rate(currentRefundedCents, currentCapturedCents),
                },
                previous: {
                  refundedCents: previousRefundedCents,
                  capturedCents: previousCapturedCents,
                  ratePercent: rate(
                    previousRefundedCents,
                    previousCapturedCents,
                  ),
                },
              },
            },
          },
        ];
      }),
    );
  }

  async overview(forceRefresh = false) {
    const env = loadEnv();
    const now = new Date();
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: { locations: { orderBy: { name: "asc" } } },
    });
    const locationIds = organizations.flatMap((organization) =>
      organization.locations.map((location) => location.id),
    );
    const [healthByOrganization, activeAuditoriums, employeeCounts, menuCategories] = await Promise.all([
      this.organizationHealthOverview(
        organizations.map((organization) => organization.id),
        now,
        forceRefresh,
      ),
      prisma.auditorium.findMany({
        where: { locationId: { in: locationIds }, active: true },
        select: {
          locationId: true,
          _count: {
            select: {
              showtimes: {
                where: { onSale: true, startsAt: { gte: now } },
              },
            },
          },
        },
      }),
      prisma.employee.groupBy({
        by: ["locationId"],
        where: {
          locationId: { in: locationIds },
          active: true,
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      prisma.menuCategory.findMany({
        where: { locationId: { in: locationIds }, active: true },
        select: {
          locationId: true,
          _count: {
            select: {
              items: { where: { active: true, is86d: false } },
            },
          },
        },
      }),
    ]);
    const auditoriumCounts = new Map<string, number>();
    const upcomingShowtimeCounts = new Map<string, number>();
    for (const auditorium of activeAuditoriums) {
      auditoriumCounts.set(
        auditorium.locationId,
        (auditoriumCounts.get(auditorium.locationId) ?? 0) + 1,
      );
      upcomingShowtimeCounts.set(
        auditorium.locationId,
        (upcomingShowtimeCounts.get(auditorium.locationId) ?? 0) +
          auditorium._count.showtimes,
      );
    }
    const employeesByLocation = new Map(
      employeeCounts.map((row) => [row.locationId, row._count._all]),
    );
    const menuItemsByLocation = new Map<string, number>();
    for (const category of menuCategories) {
      menuItemsByLocation.set(
        category.locationId,
        (menuItemsByLocation.get(category.locationId) ?? 0) +
          category._count.items,
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      deliveryReadiness: {
        email: { ready: env.EMAIL_PROVIDER === "postmark", provider: env.EMAIL_PROVIDER },
        sms: { ready: env.SMS_PROVIDER === "twilio", provider: env.SMS_PROVIDER },
        appleWallet: { ready: env.APPLE_WALLET_PROVIDER === "passkit", provider: env.APPLE_WALLET_PROVIDER },
        googleWallet: { ready: env.GOOGLE_WALLET_PROVIDER === "google", provider: env.GOOGLE_WALLET_PROVIDER },
      },
      organizations: await Promise.all(
        organizations.map(async (organization) => {
          const health = healthByOrganization.get(organization.id)!;
          return {
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
            health,
            locations: organization.locations.map((location) => {
              const auditoriums = auditoriumCounts.get(location.id) ?? 0;
              const employees = employeesByLocation.get(location.id) ?? 0;
              const menuItems = menuItemsByLocation.get(location.id) ?? 0;
              const upcomingShowtimes =
                upcomingShowtimeCounts.get(location.id) ?? 0;
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
          };
        }),
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
      membershipRevenueCents: 0,
      membershipPurchases: 0,
      donationRevenueCents: 0,
      donations: 0,
      nonprofitRevenueCents: 0,
      totalCollectedCents: 0,
      refundedCents: 0,
      ticketsSold: 0,
      fnbOrders: 0,
    });
    const revenueByLocation = await this.reporting.platformRevenueTotals(
      organizations.flatMap((organization) => organization.locations.map((location) => location.id)),
      { from, to },
    );
    const locationIds = organizations.flatMap((organization) => organization.locations.map((location) => location.id));
    const filmTickets = locationIds.length
      ? await prisma.ticket.findMany({
          where: {
            status: { notIn: ["REFUNDED", "CANCELED"] },
            showtimeSeat: {
              showtime: {
                startsAt: { gte: from, lt: to },
                auditorium: { locationId: { in: locationIds } },
              },
            },
          },
          select: {
            priceCentsPaid: true,
            showtimeSeat: {
              select: {
                showtime: {
                  select: {
                    id: true,
                    movie: { select: { id: true, catalogEntryId: true, title: true } },
                    auditorium: {
                      select: {
                        location: { select: { id: true, organizationId: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    const filmTotals = new Map<string, {
      id: string;
      catalogEntryId: string | null;
      title: string;
      organizationIds: Set<string>;
      locationIds: Set<string>;
      showtimeIds: Set<string>;
      ticketsSold: number;
      ticketRevenueCents: number;
    }>();
    for (const ticket of filmTickets) {
      const showtime = ticket.showtimeSeat.showtime;
      const key = showtime.movie.catalogEntryId ?? showtime.movie.id;
      const current = filmTotals.get(key) ?? {
        id: key,
        catalogEntryId: showtime.movie.catalogEntryId,
        title: showtime.movie.title,
        organizationIds: new Set<string>(),
        locationIds: new Set<string>(),
        showtimeIds: new Set<string>(),
        ticketsSold: 0,
        ticketRevenueCents: 0,
      };
      current.organizationIds.add(showtime.auditorium.location.organizationId);
      current.locationIds.add(showtime.auditorium.location.id);
      current.showtimeIds.add(showtime.id);
      current.ticketsSold += 1;
      current.ticketRevenueCents += ticket.priceCentsPaid;
      filmTotals.set(key, current);
    }
    const films = [...filmTotals.values()]
      .map((film) => ({
        id: film.id,
        catalogEntryId: film.catalogEntryId,
        title: film.title,
        operators: film.organizationIds.size,
        locations: film.locationIds.size,
        showtimes: film.showtimeIds.size,
        ticketsSold: film.ticketsSold,
        ticketRevenueCents: film.ticketRevenueCents,
      }))
      .sort((left, right) => right.ticketRevenueCents - left.ticketRevenueCents || right.ticketsSold - left.ticketsSold || left.title.localeCompare(right.title));
    const clients = organizations.map((organization) => {
        const totals = zero();
        for (const location of organization.locations) {
          const report = revenueByLocation.get(location.id);
          if (!report) continue;
          for (const key of Object.keys(totals) as Array<keyof typeof totals>)
            totals[key] += report[key];
        }
        return {
          id: organization.id,
          name: organization.name,
          locations: organization.locations.length,
          ...totals,
        };
      });
    const totals = zero();
    for (const client of clients)
      for (const key of Object.keys(totals) as Array<keyof typeof totals>)
        totals[key] += client[key];
    return {
      generatedAt: new Date().toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      totals,
      clients,
      films,
    };
  }

  async audienceAnalytics(input: {
    from?: string;
    to?: string;
    organizationId?: string;
  }) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 29 * 86_400_000);
    const from = new Date(`${input.from ?? defaultFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const to = new Date(`${input.to ?? now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw AppError.validationFailed("A valid audience analytics date range of 366 days or less is required.");
    }
    const clients = await prisma.organization.findMany({
      where: input.organizationId ? { id: input.organizationId } : undefined,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (input.organizationId && clients.length === 0) throw AppError.notFound("Cinema client not found.");
    const rows = await prisma.customerAnalyticsDaily.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(input.organizationId ? { location: { organizationId: input.organizationId } } : {}),
      },
      orderBy: [{ date: "asc" }, { event: "asc" }],
      select: {
        date: true,
        event: true,
        path: true,
        count: true,
        location: { select: { id: true, name: true, organization: { select: { id: true, name: true } } } },
      },
    });
    const events = [
      "Pageview", "Checkout Started", "Checkout Completed", "Account Created",
      "Gift Card Started", "Gift Card Purchased", "Membership Checkout Started",
      "Membership Activated", "Donation Checkout Started", "Donation Completed",
      "Private Event Inquiry Submitted", "Waitlist Joined",
    ] as const;
    type EventName = (typeof events)[number];
    const emptyCounts = () => Object.fromEntries(events.map((event) => [event, 0])) as Record<EventName, number>;
    const totals = emptyCounts();
    const daily = new Map<string, Record<EventName, number>>();
    const locations = new Map<string, { organization: { id: string; name: string }; location: { id: string; name: string }; events: Record<EventName, number> }>();
    const pages = new Map<string, number>();
    for (const row of rows) {
      if (!events.includes(row.event as EventName)) continue;
      const event = row.event as EventName;
      totals[event] += row.count;
      const date = row.date.toISOString().slice(0, 10);
      const dateCounts = daily.get(date) ?? emptyCounts();
      dateCounts[event] += row.count;
      daily.set(date, dateCounts);
      const location = locations.get(row.location.id) ?? {
        organization: row.location.organization,
        location: { id: row.location.id, name: row.location.name },
        events: emptyCounts(),
      };
      location.events[event] += row.count;
      locations.set(row.location.id, location);
      if (event === "Pageview" && row.path) pages.set(row.path, (pages.get(row.path) ?? 0) + row.count);
    }
    const rate = (completed: number, started: number) => started > 0 ? Number((completed / started * 100).toFixed(2)) : null;
    const withRates = (counts: Record<EventName, number>) => ({
      ...counts,
      checkoutCompletionRatePercent: rate(counts["Checkout Completed"], counts["Checkout Started"]),
      giftCardCompletionRatePercent: rate(counts["Gift Card Purchased"], counts["Gift Card Started"]),
      membershipCompletionRatePercent: rate(counts["Membership Activated"], counts["Membership Checkout Started"]),
      donationCompletionRatePercent: rate(counts["Donation Completed"], counts["Donation Checkout Started"]),
    });
    return {
      generatedAt: now.toISOString(),
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      clients,
      totals: withRates(totals),
      daily: [...daily.entries()].map(([date, counts]) => ({ date, ...counts })),
      pages: [...pages.entries()].sort((left, right) => right[1] - left[1]).slice(0, 20).map(([path, count]) => ({ path, count })),
      locations: [...locations.values()].map((location) => ({ ...location, ...withRates(location.events), events: undefined })).sort((left, right) => left.organization.name.localeCompare(right.organization.name) || left.location.name.localeCompare(right.location.name)),
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
      "Ringo ticket-fee revenue (cents)",
      "Ticket tax (cents)",
      "Ticket total collected (cents)",
      "F&B revenue (cents)",
      "Combined net (cents)",
      "Membership revenue (cents)",
      "Membership purchases",
      "Donation contributions (cents)",
      "Donations",
      "Membership and donation collections (cents)",
      "All collected (cents)",
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
      client.membershipRevenueCents,
      client.membershipPurchases,
      client.donationRevenueCents,
      client.donations,
      client.nonprofitRevenueCents,
      client.totalCollectedCents,
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
        "A Ringo Master operator with that email already exists.",
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
          "A Ringo Master operator with that email already exists.",
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
        "You cannot deactivate your own Ringo Master account.",
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
      if (!before) throw AppError.notFound("Ringo Master operator not found.");
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
          "The last active Ringo Master Owner cannot be deactivated or reassigned.",
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
    if (!target) throw AppError.notFound("Ringo Master operator not found.");
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
      registeredTicketFeeMinor: organization.registeredTicketFeeMinor,
      createdAt: organization.createdAt.toISOString(),
      payments: {
        connected: Boolean(organization.stripeConnectedAccountId),
        onboardingStatus: organization.connectOnboardingStatus,
      },
      health: await this.organizationHealth(organization.id),
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
    registeredTicketFeeMinor?: number;
    active?: boolean;
  }) {
    await prisma.$transaction(async (tx) => {
      const registeredTicketFeeMinor = input.registeredTicketFeeMinor ?? input.ticketFeeMinor;
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
          registeredTicketFeeMinor,
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
      if (registeredTicketFeeMinor !== undefined)
        await tx.priceTier.updateMany({
          where: { organizationId: input.organizationId },
          data: { registeredFeeMinor: registeredTicketFeeMinor },
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
        registeredTicketFeeMinor: organization.registeredTicketFeeMinor,
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
