import { Injectable } from "@nestjs/common";
import { decryptMfaSecret, encryptMfaSecret, hashPassword, hashPin, Permission as PermissionKey } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { Prisma, prisma } from "@cinema/database";
import { cinemaContentDefaults, cinemaContentSchema, type CinemaContent } from "@cinema/shared";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../common/app-error";

type SiteHeadingCopy = { eyebrow: string; title: string; intro: string };
type CustomerSiteCopy = {
  showtimes: SiteHeadingCopy;
  comingSoon: SiteHeadingCopy;
  filmSeries: SiteHeadingCopy;
  dining: SiteHeadingCopy;
  about: SiteHeadingCopy & { body: string[] };
};

const siteCopyFrom = (content: CinemaContent): CustomerSiteCopy => ({
  showtimes: { eyebrow: content.showtimes.eyebrow, title: content.showtimes.title, intro: content.showtimes.intro },
  comingSoon: { eyebrow: content.comingSoon.eyebrow, title: content.comingSoon.title, intro: content.comingSoon.intro },
  filmSeries: { eyebrow: content.filmSeries.eyebrow, title: content.filmSeries.title, intro: content.filmSeries.intro },
  dining: { eyebrow: content.dining.eyebrow, title: content.dining.title, intro: content.dining.intro },
  about: { eyebrow: content.about.eyebrow, title: content.about.title, intro: content.about.intro, body: content.about.body },
});

const applySiteCopy = (content: CinemaContent, copy: CustomerSiteCopy): CinemaContent => ({
  ...content,
  showtimes: { ...content.showtimes, ...copy.showtimes },
  comingSoon: { ...content.comingSoon, ...copy.comingSoon },
  filmSeries: { ...content.filmSeries, ...copy.filmSeries },
  dining: { ...content.dining, ...copy.dining },
  about: { ...content.about, ...copy.about },
});

@Injectable()
export class ManagementService {
  async settings(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      include: {
        organization: { select: { priceTiers: { orderBy: { name: "asc" }, select: { id: true, name: true, ticketPriceMinor: true, active: true } } } },
        ticketTypes: { orderBy: { name: "asc" }, select: { id: true, name: true, priceAdjustmentMinor: true, active: true } },
        taxRules: { orderBy: { name: "asc" } },
        serviceChargeRules: { orderBy: { name: "asc" } },
        promotions: { orderBy: { code: "asc" }, include: { ticketOrders: { where: { status: { in: ["PAID", "EXCHANGED"] } }, select: { subtotalCents: true, totalCents: true, discountCents: true, tickets: { select: { id: true } } } } } },
      },
    });
    const { organization, ...settings } = location;
    const content = cinemaContentSchema.safeParse(location.contentPublished ?? location.contentDraft ?? cinemaContentDefaults);
    const parsedContent = content.success ? content.data : cinemaContentDefaults;
    return { ...settings, merchUrl: parsedContent.navigation.merchUrl, siteCopy: siteCopyFrom(parsedContent), priceTiers: organization.priceTiers, promotions: location.promotions.map(({ ticketOrders, ...promotion }) => ({ ...promotion, redemptionCount: ticketOrders.length, discountedTicketCount: ticketOrders.reduce((sum, order) => sum + order.tickets.length, 0), totalTicketFaceValueCents: ticketOrders.reduce((sum, order) => sum + order.subtotalCents, 0), totalCollectedCents: ticketOrders.reduce((sum, order) => sum + order.totalCents, 0), totalDiscountCents: ticketOrders.reduce((sum, order) => sum + order.discountCents, 0) })) };
  }

  async createPriceTier(input: { locationId: string; employeeId: string; requestId: string; name: string; ticketPriceMinor: number }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true, organization: { select: { ticketFeeMinor: true } } } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${location.organizationId}))`;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({ organizationId: location.organizationId, name: input.name, ticketPriceMinor: input.ticketPriceMinor })).digest("hex");
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "ticket.price_tier_created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The price-group idempotency key was already used with different details.");
        const tier = await tx.priceTier.findUnique({ where: { id: replay.entityId } });
        if (!tier) throw AppError.conflict("The original ticket price group is no longer available.");
        return tier;
      }
      const duplicate = await tx.priceTier.findFirst({ where: { organizationId: location.organizationId, name: { equals: input.name, mode: "insensitive" } } });
      if (duplicate) throw AppError.conflict("A ticket price group with this name already exists.");
      const tier = await tx.priceTier.create({ data: { organizationId: location.organizationId, name: input.name, ticketPriceMinor: input.ticketPriceMinor, feeMinor: location.organization.ticketFeeMinor, appliesOnWeekdays: [] } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.price_tier_created", entityType: "PriceTier", entityId: tier.id, afterState: { requestId: input.requestId, requestFingerprint, name: tier.name, ticketPriceMinor: tier.ticketPriceMinor, active: tier.active } } });
      return tier;
    });
  }

  async updatePriceTier(input: { locationId: string; employeeId: string; priceTierId: string; requestId: string; name?: string; ticketPriceMinor?: number; active?: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${location.organizationId}))`;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({ priceTierId: input.priceTierId, name: input.name, ticketPriceMinor: input.ticketPriceMinor, active: input.active })).digest("hex");
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "ticket.price_tier_updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The price-group idempotency key was already used with different details.");
        const tier = await tx.priceTier.findFirst({ where: { id: replay.entityId, organizationId: location.organizationId } });
        if (!tier) throw AppError.conflict("The updated ticket price group is no longer available.");
        return tier;
      }
      const before = await tx.priceTier.findFirst({ where: { id: input.priceTierId, organizationId: location.organizationId } });
      if (!before) throw AppError.notFound("Ticket price group not found.");
      if (input.name && input.name.toLocaleLowerCase() !== before.name.toLocaleLowerCase()) {
        const duplicate = await tx.priceTier.findFirst({ where: { organizationId: location.organizationId, name: { equals: input.name, mode: "insensitive" }, id: { not: before.id } } });
        if (duplicate) throw AppError.conflict("A ticket price group with this name already exists.");
      }
      if (before.active && input.active === false) {
        const activeCount = await tx.priceTier.count({ where: { organizationId: location.organizationId, active: true } });
        if (activeCount <= 1) throw AppError.conflict("At least one ticket price group must remain active for scheduling and checkout.");
      }
      const updated = await tx.priceTier.update({ where: { id: before.id }, data: { name: input.name, ticketPriceMinor: input.ticketPriceMinor, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.price_tier_updated", entityType: "PriceTier", entityId: updated.id, beforeState: { name: before.name, ticketPriceMinor: before.ticketPriceMinor, active: before.active }, afterState: { requestId: input.requestId, requestFingerprint, name: updated.name, ticketPriceMinor: updated.ticketPriceMinor, active: updated.active } } });
      return updated;
    });
  }

  async createTicketType(input: { locationId: string; employeeId: string; requestId: string; name: string; priceAdjustmentMinor: number }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId: input.locationId, name: input.name, priceAdjustmentMinor: input.priceAdjustmentMinor })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.locationId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "ticket.type_created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The admission-type idempotency key was already used with different details.");
        const ticketType = await tx.ticketType.findUnique({ where: { id: replay.entityId } });
        if (!ticketType) throw AppError.conflict("The original admission type is no longer available.");
        return ticketType;
      }
      const duplicate = await tx.ticketType.findFirst({ where: { locationId: input.locationId, name: { equals: input.name, mode: "insensitive" } } });
      if (duplicate) throw AppError.conflict("A ticket type with this name already exists.");
      const ticketType = await tx.ticketType.create({ data: { locationId: input.locationId, name: input.name, priceAdjustmentMinor: input.priceAdjustmentMinor } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.type_created", entityType: "TicketType", entityId: ticketType.id, afterState: { requestId: input.requestId, requestFingerprint, name: ticketType.name, priceAdjustmentMinor: ticketType.priceAdjustmentMinor, active: ticketType.active } } });
      return ticketType;
    });
  }

  async updateTicketType(input: { locationId: string; employeeId: string; ticketTypeId: string; requestId: string; name?: string; priceAdjustmentMinor?: number; active?: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.locationId}))`;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({ ticketTypeId: input.ticketTypeId, name: input.name, priceAdjustmentMinor: input.priceAdjustmentMinor, active: input.active })).digest("hex");
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "ticket.type_updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The admission-type idempotency key was already used with different details.");
        const ticketType = await tx.ticketType.findFirst({ where: { id: replay.entityId, locationId: input.locationId } });
        if (!ticketType) throw AppError.conflict("The updated admission type is no longer available.");
        return ticketType;
      }
      const before = await tx.ticketType.findFirst({ where: { id: input.ticketTypeId, locationId: input.locationId } });
      if (!before) throw AppError.notFound("Ticket type not found.");
      if (input.name && input.name.toLocaleLowerCase() !== before.name.toLocaleLowerCase()) {
        const duplicate = await tx.ticketType.findFirst({ where: { locationId: input.locationId, name: { equals: input.name, mode: "insensitive" }, id: { not: before.id } } });
        if (duplicate) throw AppError.conflict("A ticket type with this name already exists.");
      }
      if (before.active && input.active === false) {
        const activeCount = await tx.ticketType.count({ where: { locationId: input.locationId, active: true } });
        if (activeCount <= 1) throw AppError.conflict("At least one ticket type must remain active for checkout.");
      }
      const updated = await tx.ticketType.update({ where: { id: before.id }, data: { name: input.name, priceAdjustmentMinor: input.priceAdjustmentMinor, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.type_updated", entityType: "TicketType", entityId: updated.id, beforeState: { name: before.name, priceAdjustmentMinor: before.priceAdjustmentMinor, active: before.active }, afterState: { requestId: input.requestId, requestFingerprint, name: updated.name, priceAdjustmentMinor: updated.priceAdjustmentMinor, active: updated.active } } });
      return updated;
    });
  }

  async updateLocation(input: { locationId: string; employeeId: string; name?: string; address?: string | null; timezone?: string; timeClockEnabled?: boolean; ticketTaxRateBasisPoints?: number; preShowBufferMinutes?: number; cleaningBufferMinutes?: number; checkDropMinutesBeforeEnd?: number; autoSettleGraceMinutes?: number; autoSettleTipBasisPoints?: number }) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
      const updated = await tx.location.update({ where: { id: input.locationId }, data: {
        name: input.name, address: input.address, timezone: input.timezone,
        timeClockEnabled: input.timeClockEnabled, ticketTaxRateBasisPoints: input.ticketTaxRateBasisPoints,
        preShowBufferMinutes: input.preShowBufferMinutes, cleaningBufferMinutes: input.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: input.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: input.autoSettleGraceMinutes,
        autoSettleTipBasisPoints: input.autoSettleTipBasisPoints,
      } });
      const settingsState = (location: typeof updated) => ({ name: location.name, address: location.address, timezone: location.timezone, timeClockEnabled: location.timeClockEnabled, ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints, preShowBufferMinutes: location.preShowBufferMinutes, cleaningBufferMinutes: location.cleaningBufferMinutes, checkDropMinutesBeforeEnd: location.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: location.autoSettleGraceMinutes, autoSettleTipBasisPoints: location.autoSettleTipBasisPoints });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "location.settings_updated", entityType: "Location", entityId: input.locationId, beforeState: settingsState(before), afterState: settingsState(updated) } });
      return updated;
    });
  }

  async updateBranding(input: { locationId: string; employeeId: string; name?: string; logoUrl?: string | null; accentColor?: string | null; accentMutedColor?: string | null; backgroundColor?: string | null; backgroundGlowColor?: string | null; surfaceColor?: string | null; textColor?: string | null; mutedTextColor?: string | null; adminAccentColor?: string | null; adminAccentMutedColor?: string | null; adminBackgroundColor?: string | null; adminSurfaceColor?: string | null; adminTextColor?: string | null; adminMutedTextColor?: string | null }) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
      const updated = await tx.location.update({ where: { id: input.locationId }, data: {
        name: input.name,
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
      } });
      const state = (location: typeof updated) => ({
        name: location.name, logoUrl: location.customerLogoUrl,
        accentColor: location.customerAccentColor, accentMutedColor: location.customerAccentMutedColor,
        backgroundColor: location.customerBackgroundColor, backgroundGlowColor: location.customerBackgroundGlowColor,
        surfaceColor: location.customerSurfaceColor, textColor: location.customerTextColor, mutedTextColor: location.customerMutedTextColor,
        adminAccentColor: location.adminAccentColor, adminAccentMutedColor: location.adminAccentMutedColor,
        adminBackgroundColor: location.adminBackgroundColor, adminSurfaceColor: location.adminSurfaceColor,
        adminTextColor: location.adminTextColor, adminMutedTextColor: location.adminMutedTextColor,
      });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "location.branding_updated", entityType: "Location", entityId: input.locationId, beforeState: state(before), afterState: state(updated) } });
      return updated;
    });
  }

  async updateMerch(input: { locationId: string; employeeId: string; merchUrl: string | null }) {
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUniqueOrThrow({
        where: { id: input.locationId },
        select: { contentDraft: true, contentPublished: true },
      });
      const draftResult = cinemaContentSchema.safeParse(location.contentDraft ?? location.contentPublished ?? cinemaContentDefaults);
      const publishedResult = cinemaContentSchema.safeParse(location.contentPublished ?? location.contentDraft ?? cinemaContentDefaults);
      const draft = draftResult.success ? draftResult.data : cinemaContentDefaults;
      const published = publishedResult.success ? publishedResult.data : cinemaContentDefaults;
      const nextDraft = { ...draft, navigation: { ...draft.navigation, merchUrl: input.merchUrl } };
      const nextPublished = { ...published, navigation: { ...published.navigation, merchUrl: input.merchUrl } };
      const publishedAt = new Date();
      await tx.location.update({ where: { id: input.locationId }, data: {
        contentDraft: nextDraft as Prisma.InputJsonValue,
        contentPublished: nextPublished as Prisma.InputJsonValue,
        contentPublishedAt: publishedAt,
      } });
      await tx.auditEvent.create({ data: {
        actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
        action: "location.merch_updated", entityType: "Location", entityId: input.locationId,
        beforeState: { merchUrl: published.navigation.merchUrl }, afterState: { merchUrl: input.merchUrl },
      } });
      return { merchUrl: input.merchUrl, publishedAt };
    });
  }

  async updateSiteCopy(input: { locationId: string; employeeId: string } & CustomerSiteCopy) {
    return prisma.$transaction(async (tx) => {
      const { locationId, employeeId, ...copy } = input;
      const location = await tx.location.findUniqueOrThrow({ where: { id: locationId }, select: { contentDraft: true, contentPublished: true } });
      const draftResult = cinemaContentSchema.safeParse(location.contentDraft ?? location.contentPublished ?? cinemaContentDefaults);
      const publishedResult = cinemaContentSchema.safeParse(location.contentPublished ?? location.contentDraft ?? cinemaContentDefaults);
      const draft = draftResult.success ? draftResult.data : cinemaContentDefaults;
      const published = publishedResult.success ? publishedResult.data : cinemaContentDefaults;
      const publishedAt = new Date();
      await tx.location.update({ where: { id: locationId }, data: { contentDraft: applySiteCopy(draft, copy) as Prisma.InputJsonValue, contentPublished: applySiteCopy(published, copy) as Prisma.InputJsonValue, contentPublishedAt: publishedAt } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId, action: "location.site_copy_updated", entityType: "Location", entityId: locationId, beforeState: siteCopyFrom(published) as Prisma.InputJsonValue, afterState: copy as Prisma.InputJsonValue } });
      return { siteCopy: copy, publishedAt };
    });
  }

  async updateMenuPresentation(input: { locationId: string; employeeId: string; assetUrl: string | null; assetType: "IMAGE" | "PDF" | null }) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
      const updated = await tx.location.update({
        where: { id: input.locationId },
        data: { diningMenuAssetUrl: input.assetUrl, diningMenuAssetType: input.assetType },
      });
      await tx.auditEvent.create({ data: {
        actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
        action: "menu.presentation_updated", entityType: "Location", entityId: input.locationId,
        beforeState: { assetUrl: before.diningMenuAssetUrl, assetType: before.diningMenuAssetType },
        afterState: { assetUrl: updated.diningMenuAssetUrl, assetType: updated.diningMenuAssetType },
      } });
      return { assetUrl: updated.diningMenuAssetUrl, assetType: updated.diningMenuAssetType };
    });
  }

  async menuPresentation(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { diningMenuAssetUrl: true, diningMenuAssetType: true },
    });
    return { assetUrl: location.diningMenuAssetUrl, assetType: location.diningMenuAssetType };
  }

  async createTaxRule(input: { locationId: string; employeeId: string; requestId: string; name: string; appliesTo: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille: number; active: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "tax_rule.created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The tax-rule idempotency key was already used with different details.");
        const rule = await tx.taxRule.findUnique({ where: { id: replay.entityId } });
        if (!rule) throw AppError.conflict("The original tax rule is no longer available.");
        return rule;
      }
      const rule = await tx.taxRule.create({ data: { locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "tax_rule.created", entityType: "TaxRule", entityId: rule.id, afterState: { requestId: input.requestId, requestFingerprint, name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, active: rule.active } } });
      return rule;
    });
  }

  async updateTaxRule(input: { locationId: string; employeeId: string; ruleId: string; requestId: string; name?: string; appliesTo?: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number; active?: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ ruleId: input.ruleId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "tax_rule.updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The tax-rule idempotency key was already used with different details.");
        const rule = await tx.taxRule.findFirst({ where: { id: replay.entityId, locationId: input.locationId } });
        if (!rule) throw AppError.conflict("The updated tax rule is no longer available.");
        return rule;
      }
      const before = await tx.taxRule.findFirst({ where: { id: input.ruleId, locationId: input.locationId } });
      if (!before) throw AppError.notFound("Tax rule was not found.");
      const updated = await tx.taxRule.update({ where: { id: before.id }, data: { name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active } });
      const state = (rule: typeof updated) => ({ name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, active: rule.active });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "tax_rule.updated", entityType: "TaxRule", entityId: updated.id, beforeState: state(before), afterState: { ...state(updated), requestId: input.requestId, requestFingerprint } } });
      return updated;
    });
  }

  async createServiceCharge(input: { locationId: string; employeeId: string; requestId: string; name: string; appliesTo: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number; flatCents?: number; autoApply: boolean; active: boolean }) {
    if ((input.ratePermille == null) === (input.flatCents == null)) throw AppError.validationFailed("Provide exactly one percentage rate or flat amount.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille ?? null, flatCents: input.flatCents ?? null, autoApply: input.autoApply, active: input.active })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "service_charge_rule.created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The service-charge idempotency key was already used with different details.");
        const rule = await tx.serviceChargeRule.findUnique({ where: { id: replay.entityId } });
        if (!rule) throw AppError.conflict("The original service-charge rule is no longer available.");
        return rule;
      }
      const rule = await tx.serviceChargeRule.create({ data: { locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, flatCents: input.flatCents, autoApply: input.autoApply, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "service_charge_rule.created", entityType: "ServiceChargeRule", entityId: rule.id, afterState: { requestId: input.requestId, requestFingerprint, name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, flatCents: rule.flatCents, autoApply: rule.autoApply, active: rule.active } } });
      return rule;
    });
  }

  async updateServiceCharge(input: { locationId: string; employeeId: string; ruleId: string; requestId: string; name?: string; appliesTo?: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number | null; flatCents?: number | null; autoApply?: boolean; active?: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ ruleId: input.ruleId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, flatCents: input.flatCents, autoApply: input.autoApply, active: input.active })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "service_charge_rule.updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The service-charge idempotency key was already used with different details.");
        const rule = await tx.serviceChargeRule.findFirst({ where: { id: replay.entityId, locationId: input.locationId } });
        if (!rule) throw AppError.conflict("The updated service-charge rule is no longer available.");
        return rule;
      }
      const before = await tx.serviceChargeRule.findFirst({ where: { id: input.ruleId, locationId: input.locationId } });
      if (!before) throw AppError.notFound("Service-charge rule was not found.");
      const ratePermille = input.ratePermille === undefined ? before.ratePermille : input.ratePermille;
      const flatCents = input.flatCents === undefined ? before.flatCents : input.flatCents;
      if ((ratePermille == null) === (flatCents == null)) throw AppError.validationFailed("Provide exactly one percentage rate or flat amount.");
      const updated = await tx.serviceChargeRule.update({ where: { id: before.id }, data: { name: input.name, appliesTo: input.appliesTo, ratePermille, flatCents, autoApply: input.autoApply, active: input.active } });
      const state = (rule: typeof updated) => ({ name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, flatCents: rule.flatCents, autoApply: rule.autoApply, active: rule.active });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "service_charge_rule.updated", entityType: "ServiceChargeRule", entityId: updated.id, beforeState: state(before), afterState: { ...state(updated), requestId: input.requestId, requestFingerprint } } });
      return updated;
    });
  }

  async createPromotion(input: { locationId: string; employeeId: string; requestId: string; code: string; name: string; type: "FIXED_AMOUNT" | "PERCENTAGE" | "COMP"; amountCents?: number; percentageBasisPoints?: number; minimumSubtotalCents?: number; maximumRedemptions?: number; active: boolean; startsAt?: Date; endsAt?: Date }) {
    if (input.type === "FIXED_AMOUNT" && input.amountCents == null) throw AppError.validationFailed("A fixed promotion requires an amount.");
    if (input.type === "PERCENTAGE" && input.percentageBasisPoints == null) throw AppError.validationFailed("A percentage promotion requires a percentage.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId: input.locationId, code: input.code.toUpperCase(), name: input.name, type: input.type, amountCents: input.amountCents ?? null, percentageBasisPoints: input.percentageBasisPoints ?? null, minimumSubtotalCents: input.minimumSubtotalCents ?? null, maximumRedemptions: input.maximumRedemptions ?? null, active: input.active, startsAt: input.startsAt?.toISOString() ?? null, endsAt: input.endsAt?.toISOString() ?? null })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "promotion.created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The promotion idempotency key was already used with different details.");
        const promotion = await tx.promotion.findUnique({ where: { id: replay.entityId } });
        if (!promotion) throw AppError.conflict("The original promotion is no longer available.");
        return promotion;
      }
      const promotion = await tx.promotion.create({ data: { locationId: input.locationId, code: input.code.toUpperCase(), name: input.name, type: input.type, amountCents: input.type === "FIXED_AMOUNT" ? input.amountCents : null, percentageBasisPoints: input.type === "PERCENTAGE" ? input.percentageBasisPoints : null, minimumSubtotalCents: input.minimumSubtotalCents, maximumRedemptions: input.maximumRedemptions, active: input.active, startsAt: input.startsAt, endsAt: input.endsAt } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "promotion.created", entityType: "Promotion", entityId: promotion.id, afterState: { requestId: input.requestId, requestFingerprint, code: promotion.code, name: promotion.name, type: promotion.type, amountCents: promotion.amountCents, percentageBasisPoints: promotion.percentageBasisPoints, minimumSubtotalCents: promotion.minimumSubtotalCents, maximumRedemptions: promotion.maximumRedemptions, active: promotion.active } } });
      return promotion;
    });
  }

  async updatePromotion(input: { locationId: string; employeeId: string; promotionId: string; requestId: string; code?: string; name?: string; type?: "FIXED_AMOUNT" | "PERCENTAGE" | "COMP"; amountCents?: number | null; percentageBasisPoints?: number | null; minimumSubtotalCents?: number | null; maximumRedemptions?: number | null; active?: boolean; startsAt?: Date | null; endsAt?: Date | null }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ ...input, employeeId: undefined, requestId: undefined })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "promotion.updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The promotion idempotency key was already used with different details.");
        const promotion = await tx.promotion.findFirst({ where: { id: replay.entityId, locationId: input.locationId } });
        if (!promotion) throw AppError.conflict("The updated promotion is no longer available.");
        return promotion;
      }
      const before = await tx.promotion.findFirst({ where: { id: input.promotionId, locationId: input.locationId } });
      if (!before) throw AppError.notFound("Promotion was not found.");
      const type = input.type ?? before.type;
      const amountCents = input.amountCents === undefined ? before.amountCents : input.amountCents;
      const percentageBasisPoints = input.percentageBasisPoints === undefined ? before.percentageBasisPoints : input.percentageBasisPoints;
      if (type === "FIXED_AMOUNT" && amountCents == null) throw AppError.validationFailed("A fixed promotion requires an amount.");
      if (type === "PERCENTAGE" && percentageBasisPoints == null) throw AppError.validationFailed("A percentage promotion requires a percentage.");
      const startsAt = input.startsAt === undefined ? before.startsAt : input.startsAt;
      const endsAt = input.endsAt === undefined ? before.endsAt : input.endsAt;
      if (startsAt && endsAt && startsAt >= endsAt) throw AppError.validationFailed("Promotion end time must be after its start time.");
      const updated = await tx.promotion.update({ where: { id: before.id }, data: { code: input.code?.toUpperCase(), name: input.name, type, amountCents: type === "FIXED_AMOUNT" ? amountCents : null, percentageBasisPoints: type === "PERCENTAGE" ? percentageBasisPoints : null, minimumSubtotalCents: input.minimumSubtotalCents, maximumRedemptions: input.maximumRedemptions, active: input.active, startsAt, endsAt } });
      const state = (promotion: typeof updated) => ({ code: promotion.code, name: promotion.name, type: promotion.type, amountCents: promotion.amountCents, percentageBasisPoints: promotion.percentageBasisPoints, minimumSubtotalCents: promotion.minimumSubtotalCents, maximumRedemptions: promotion.maximumRedemptions, active: promotion.active, startsAt: promotion.startsAt, endsAt: promotion.endsAt });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "promotion.updated", entityType: "Promotion", entityId: updated.id, beforeState: state(before), afterState: { ...state(updated), requestId: input.requestId, requestFingerprint } } });
      return updated;
    });
  }

  async people(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const [employees, roles, permissions] = await Promise.all([
      prisma.employee.findMany({ where: { locationId }, select: { id: true, name: true, email: true, active: true, authAccount: { select: { mfaEnabled: true } }, employeeRoles: { where: { locationId }, select: { roleId: true, role: { select: { key: true, name: true } } } } }, orderBy: { name: "asc" } }),
      prisma.role.findMany({ where: { organizationId: location.organizationId }, include: { rolePermissions: { include: { permission: true } } }, orderBy: { name: "asc" } }),
      prisma.permission.findMany({ orderBy: { key: "asc" } }),
    ]);
    return { employees, roles, permissions };
  }

  privateEventInquiries(locationId: string, filters: { status?: string; query?: string } = {}) {
    const query = filters.query?.trim();
    return prisma.privateEventInquiry.findMany({
      where: {
        locationId,
        status: filters.status,
        ...(query ? { OR: ["name", "email", "phone", "eventType", "message"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  privateEventInquiriesCsv(rows: Awaited<ReturnType<ManagementService["privateEventInquiries"]>>) {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [
      "Status,Received,Name,Email,Phone,Event type,Preferred date,Guest count,Message",
      ...rows.map((row) => [
        row.status,
        row.createdAt.toISOString(),
        row.name,
        row.email,
        row.phone,
        row.eventType,
        row.preferredDate?.toISOString(),
        row.guestCount,
        row.message,
      ].map(cell).join(",")),
    ].join("\n");
  }

  async updatePrivateEventInquiry(locationId: string, employeeId: string, inquiryId: string, status: string | undefined, requestId: string) {
    if (!status || !["NEW", "CONTACTED", "BOOKED", "CLOSED"].includes(status)) throw AppError.validationFailed("A valid inquiry status is required.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ inquiryId, status })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId, action: "private_event_inquiry.status_updated", afterState: { path: ["requestId"], equals: requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The inquiry-status idempotency key was already used with different details.");
        const inquiry = await tx.privateEventInquiry.findFirst({ where: { id: replay.entityId, locationId } });
        if (!inquiry) throw AppError.conflict("The updated inquiry is no longer available.");
        return inquiry;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inquiryId}))`;
      const inquiry = await tx.privateEventInquiry.findFirst({ where: { id: inquiryId, locationId } });
      if (!inquiry) throw AppError.notFound("Private-event inquiry was not found.");
      if (inquiry.status === status) return inquiry;
      const updated = await tx.privateEventInquiry.update({ where: { id: inquiry.id }, data: { status } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId, action: "private_event_inquiry.status_updated", entityType: "PrivateEventInquiry", entityId: inquiry.id, beforeState: { status: inquiry.status }, afterState: { status, requestId, requestFingerprint } } });
      return updated;
    });
  }

  async giftCards(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId }, select: { organizationId: true } });
    return prisma.giftCard.findMany({
      where: { organizationId: location.organizationId },
      select: { id: true, codeLast4: true, initialBalanceCents: true, balanceCents: true, currency: true, recipientName: true, recipientEmail: true, status: true, createdAt: true, issuedAtLocation: { select: { name: true } }, transactions: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, amountCents: true, balanceAfterCents: true, reference: true, createdAt: true, location: { select: { name: true } }, employee: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async issueGiftCard(input: { requestId: string; locationId: string; employeeId: string; amountCents: number; recipientName?: string; recipientEmail?: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("A valid gift card issuance idempotency key is required.");
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true, currency: true } });
    const existing = await prisma.giftCard.findUnique({
      where: { issuanceRequestId: input.requestId },
      select: {
        id: true, organizationId: true, issuedAtLocationId: true, issuedByEmployeeId: true,
        initialBalanceCents: true, balanceCents: true, currency: true, recipientName: true,
        recipientEmail: true, status: true, createdAt: true, issuanceCodeEncrypted: true,
      },
    });
    if (existing) {
      const matches = existing.organizationId === location.organizationId && existing.issuedAtLocationId === input.locationId && existing.issuedByEmployeeId === input.employeeId && existing.initialBalanceCents === input.amountCents && existing.recipientName === (input.recipientName ?? null) && existing.recipientEmail === (input.recipientEmail?.toLowerCase() ?? null);
      if (!matches) throw AppError.conflict("The gift card issuance idempotency key was already used with different details.");
      const code = decryptMfaSecret(existing.issuanceCodeEncrypted!, loadEnv().JWT_REFRESH_SECRET);
      return {
        id: existing.id, codeLast4: code.replace(/[^A-Z0-9]/g, "").slice(-4),
        initialBalanceCents: existing.initialBalanceCents, balanceCents: existing.balanceCents,
        currency: existing.currency, recipientName: existing.recipientName, recipientEmail: existing.recipientEmail,
        status: existing.status, createdAt: existing.createdAt,
        code,
      };
    }
    const raw = randomBytes(12).toString("hex").toUpperCase();
    const code = `ATGC-${raw.match(/.{1,4}/g)!.join("-")}`;
    const codeHash = createHash("sha256").update(code.replace(/[^A-Z0-9]/g, "")).digest("hex");
    let giftCard;
    try {
      giftCard = await prisma.$transaction(async (tx) => {
      const created = await tx.giftCard.create({
        data: {
          organizationId: location.organizationId,
          issuedAtLocationId: input.locationId,
          issuedByEmployeeId: input.employeeId,
          issuanceRequestId: input.requestId,
          issuanceCodeEncrypted: encryptMfaSecret(code, loadEnv().JWT_REFRESH_SECRET),
          codeHash,
          codeLast4: raw.slice(-4),
          initialBalanceCents: input.amountCents,
          balanceCents: input.amountCents,
          currency: location.currency,
          recipientName: input.recipientName,
          recipientEmail: input.recipientEmail?.toLowerCase(),
          transactions: { create: { locationId: input.locationId, employeeId: input.employeeId, type: "ISSUANCE", amountCents: input.amountCents, balanceAfterCents: input.amountCents } },
        },
        select: { id: true, codeLast4: true, initialBalanceCents: true, balanceCents: true, currency: true, recipientName: true, recipientEmail: true, status: true, createdAt: true },
      });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "gift_card.issued", entityType: "GiftCard", entityId: created.id, afterState: { codeLast4: created.codeLast4, initialBalanceCents: created.initialBalanceCents, currency: created.currency, recipientEmail: created.recipientEmail } } });
      return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const concurrent = await prisma.giftCard.findUnique({ where: { issuanceRequestId: input.requestId } });
          if (concurrent?.issuanceCodeEncrypted) {
            const concurrentCode = decryptMfaSecret(concurrent.issuanceCodeEncrypted, loadEnv().JWT_REFRESH_SECRET);
            return {
              id: concurrent.id, codeLast4: concurrent.codeLast4,
              initialBalanceCents: concurrent.initialBalanceCents, balanceCents: concurrent.balanceCents,
              currency: concurrent.currency, recipientName: concurrent.recipientName, recipientEmail: concurrent.recipientEmail,
              status: concurrent.status, createdAt: concurrent.createdAt, code: concurrentCode,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, attempt * 10));
        }
        throw AppError.conflict("The gift card issuance is still being created. Please retry.");
      }
      throw error;
    }
    return { ...giftCard, code };
  }

  async updateGiftCardStatus(input: { locationId: string; employeeId: string; giftCardId: string; requestId: string; status: "ACTIVE" | "DEACTIVATED" }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ giftCardId: input.giftCardId, status: input.status })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "gift_card.status_updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The gift-card status idempotency key was already used with different details.");
        const card = await tx.giftCard.findUnique({ where: { id: replay.entityId }, select: { id: true, status: true } });
        if (!card) throw AppError.conflict("The updated gift card is no longer available.");
        return card;
      }
      const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.giftCardId}))`;
      const card = await tx.giftCard.findFirst({ where: { id: input.giftCardId, organizationId: location.organizationId }, select: { id: true, status: true } });
      if (!card) throw AppError.notFound("Gift card was not found.");
      if (card.status === input.status) return card;
      const updated = await tx.giftCard.update({ where: { id: card.id }, data: { status: input.status }, select: { id: true, status: true } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "gift_card.status_updated", entityType: "GiftCard", entityId: card.id, beforeState: { status: card.status }, afterState: { status: updated.status, requestId: input.requestId, requestFingerprint } } });
      return updated;
    });
  }

  async customer(locationId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, ticketOrders: { some: { locationId } } }, select: { id: true, name: true, email: true, phone: true } });
    if (!customer) throw AppError.notFound("Customer was not found.");
    return customer;
  }

  async paymentMethod(locationId: string, paymentMethodId: string) {
    const method = await prisma.paymentMethodReference.findFirst({ where: { id: paymentMethodId, paymentCustomer: { organization: { locations: { some: { id: locationId } } } } }, select: { id: true, brand: true, last4: true, expMonth: true, expYear: true, active: true, paymentCustomer: { select: { customerId: true } } } });
    if (!method) throw AppError.notFound("Payment method was not found.");
    return method;
  }

  async createEmployee(input: { locationId: string; employeeId: string; requestId: string; name: string; email: string; password: string; pin?: string; roleIds: string[] }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const normalizedRoleIds = [...new Set(input.roleIds)].sort();
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId: input.locationId, name: input.name, email: input.email.toLowerCase(), roleIds: normalizedRoleIds, hasPin: Boolean(input.pin) })).digest("hex");
    const roleCount = await prisma.role.count({ where: { id: { in: normalizedRoleIds }, organizationId: location.organizationId } });
    if (roleCount !== normalizedRoleIds.length) throw AppError.notFound("One or more roles were not found.");
    const passwordHash = await hashPassword(input.password);
    const pinHash = input.pin ? await hashPin(input.pin) : undefined;
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "employee.created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The employee idempotency key was already used with different details.");
        const employee = await tx.employee.findFirst({ where: { id: replay.entityId, locationId: input.locationId }, select: { id: true, name: true, email: true, active: true } });
        if (!employee) throw AppError.conflict("The created employee is no longer available.");
        return employee;
      }
      const employee = await tx.employee.create({ data: { locationId: input.locationId, name: input.name, email: input.email.toLowerCase(), authAccount: { create: { passwordHash, pinHash } }, employeeRoles: { create: normalizedRoleIds.map((roleId) => ({ roleId, locationId: input.locationId })) } }, select: { id: true, name: true, email: true, active: true } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "employee.created", entityType: "Employee", entityId: employee.id, afterState: { requestId: input.requestId, requestFingerprint, name: employee.name, email: employee.email, roleIds: normalizedRoleIds } } });
      return employee;
    });
  }

  async updateEmployee(input: { locationId: string; actorId: string; targetId: string; requestId: string; name?: string; email?: string; active?: boolean; roleIds?: string[] }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const normalizedEmail = input.email?.toLowerCase();
    const normalizedRoleIds = input.roleIds ? [...new Set(input.roleIds)].sort() : undefined;
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ targetId: input.targetId, name: input.name, email: normalizedEmail, active: input.active, roleIds: normalizedRoleIds })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "employee.access_updated", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The employee-update idempotency key was already used with different details.");
        const employee = await tx.employee.findFirst({ where: { id: replay.entityId, locationId: input.locationId } });
        if (!employee) throw AppError.conflict("The updated employee is no longer available.");
        return employee;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.targetId}))`;
      const target = await tx.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId } });
      if (!target) throw AppError.notFound("Employee was not found.");
      if (normalizedEmail) {
        const duplicate = await tx.employee.findFirst({ where: { id: { not: target.id }, email: { equals: normalizedEmail, mode: "insensitive" } } });
        if (duplicate) throw AppError.conflict("An employee with that email already exists.");
      }
      if (normalizedRoleIds) {
        const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
        const roleCount = await tx.role.count({ where: { id: { in: normalizedRoleIds }, organizationId: location.organizationId } });
        if (roleCount !== normalizedRoleIds.length) throw AppError.notFound("One or more roles were not found.");
        await tx.employeeRole.deleteMany({ where: { employeeId: target.id, locationId: input.locationId } });
        await tx.employeeRole.createMany({ data: normalizedRoleIds.map((roleId) => ({ employeeId: target.id, roleId, locationId: input.locationId })) });
      }
      const updated = await tx.employee.update({ where: { id: target.id }, data: { name: input.name, email: normalizedEmail, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.actorId, locationId: input.locationId, action: "employee.access_updated", entityType: "Employee", entityId: target.id, beforeState: { name: target.name, email: target.email, active: target.active }, afterState: { requestId: input.requestId, requestFingerprint, name: updated.name, email: updated.email, active: updated.active, roleIds: normalizedRoleIds } } });
      return updated;
    });
  }

  async resetEmployeeCredentials(input: { locationId: string; actorId: string; targetId: string; requestId: string; password?: string; pin?: string | null; resetMfa?: boolean }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ targetId: input.targetId, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, pinRemoved: input.pin === null, resetMfa: Boolean(input.resetMfa) })).digest("hex");
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const pinHash = typeof input.pin === "string" ? await hashPin(input.pin) : input.pin === null ? null : undefined;
    const resetMfa = Boolean(input.password || input.resetMfa);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "employee.credentials_reset", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The credential-reset idempotency key was already used with different details.");
        return { id: replay.entityId, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, mustChangePassword: Boolean(input.password), mfaReset: resetMfa };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.targetId}))`;
      const target = await tx.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId }, include: { authAccount: true } });
      if (!target?.authAccount) throw AppError.notFound("Employee credentials were not found.");
      await tx.staffAuthAccount.update({ where: { employeeId: target.id }, data: {
        passwordHash,
        pinHash,
        mustChangePassword: input.password ? true : undefined,
        mfaEnabled: resetMfa ? false : undefined,
        mfaSecretEncrypted: resetMfa ? null : undefined,
        refreshTokenVersion: { increment: 1 },
      } });
      await tx.auditEvent.create({ data: {
        actorType: "EMPLOYEE", actorId: input.actorId, locationId: input.locationId,
        action: "employee.credentials_reset", entityType: "Employee", entityId: target.id,
        afterState: { requestId: input.requestId, requestFingerprint, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, pinRemoved: input.pin === null, mustChangePassword: Boolean(input.password), mfaReset: resetMfa },
      } });
      return { id: target.id, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, mustChangePassword: Boolean(input.password), mfaReset: resetMfa };
    });
  }

  async createRole(input: { locationId: string; employeeId: string; name: string; requestId: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ name: input.name })).digest("hex");
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "role.created", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The role-creation idempotency key was already used with different details.");
        const role = await tx.role.findFirst({ where: { id: replay.entityId, organizationId: location.organizationId }, include: { rolePermissions: true } });
        if (!role) throw AppError.conflict("The created role is no longer available.");
        return role;
      }
      const duplicate = await tx.role.findFirst({ where: { organizationId: location.organizationId, name: { equals: input.name, mode: "insensitive" } } });
      if (duplicate) throw AppError.conflict("A role with that name already exists.");
      const role = await tx.role.create({ data: { organizationId: location.organizationId, key: `CUSTOM_${randomUUID().replaceAll("-", "").toUpperCase()}`, name: input.name } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.created", entityType: "Role", entityId: role.id, afterState: { requestId: input.requestId, requestFingerprint, key: role.key, name: role.name, permissionKeys: [] } } });
      return { ...role, rolePermissions: [] };
    });
  }

  async updateRole(input: { locationId: string; employeeId: string; roleId: string; name: string; requestId: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ roleId: input.roleId, name: input.name })).digest("hex");
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "role.renamed", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The role-rename idempotency key was already used with different details.");
        const role = await tx.role.findFirst({ where: { id: replay.entityId, organizationId: location.organizationId } });
        if (!role) throw AppError.conflict("The renamed role is no longer available.");
        return role;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.roleId}))`;
      const role = await tx.role.findFirst({ where: { id: input.roleId, organizationId: location.organizationId } });
      if (!role) throw AppError.notFound("Role was not found.");
      if (!role.key.startsWith("CUSTOM_")) throw AppError.forbidden("Built-in roles cannot be renamed.");
      const duplicate = await tx.role.findFirst({ where: { organizationId: location.organizationId, id: { not: role.id }, name: { equals: input.name, mode: "insensitive" } } });
      if (duplicate) throw AppError.conflict("A role with that name already exists.");
      const updated = await tx.role.update({ where: { id: role.id }, data: { name: input.name } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.renamed", entityType: "Role", entityId: role.id, beforeState: { name: role.name }, afterState: { requestId: input.requestId, requestFingerprint, name: updated.name } } });
      return updated;
    });
  }

  async deleteRole(input: { locationId: string; employeeId: string; roleId: string }) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId: location.organizationId }, include: { _count: { select: { employeeRoles: true } } } });
    if (!role) throw AppError.notFound("Role was not found.");
    if (!role.key.startsWith("CUSTOM_")) throw AppError.forbidden("Built-in roles cannot be deleted.");
    if (role._count.employeeRoles > 0) throw AppError.conflict("Remove this role from every employee before deleting it.");
    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.deleted", entityType: "Role", entityId: role.id, beforeState: { key: role.key, name: role.name } } });
      await tx.role.delete({ where: { id: role.id } });
    });
    return { id: role.id, deleted: true };
  }

  async updateRolePermissions(input: { locationId: string; employeeId: string; roleId: string; permissionKeys: string[] }) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId: location.organizationId }, include: { rolePermissions: { include: { permission: true } } } });
    if (!role) throw AppError.notFound("Role was not found.");
    const allowed = new Set(Object.values(PermissionKey));
    if (input.permissionKeys.some((key) => !allowed.has(key as PermissionKey))) throw AppError.validationFailed("The request contains an unknown permission.");
    const permissions = await prisma.permission.findMany({ where: { key: { in: [...new Set(input.permissionKeys)] } } });
    if (permissions.length !== new Set(input.permissionKeys).size) throw AppError.validationFailed("One or more permissions are not available.");
    return prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.permissions_updated", entityType: "Role", entityId: role.id, beforeState: { permissionKeys: role.rolePermissions.map((entry) => entry.permission.key) }, afterState: { permissionKeys: input.permissionKeys } } });
      return { id: role.id, permissionKeys: input.permissionKeys };
    });
  }
}
