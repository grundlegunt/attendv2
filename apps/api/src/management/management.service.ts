import { Injectable } from "@nestjs/common";
import { hashPassword, hashPin, Permission as PermissionKey } from "@cinema/auth";
import { prisma } from "@cinema/database";
import { randomUUID } from "node:crypto";
import { AppError } from "../common/app-error";

@Injectable()
export class ManagementService {
  async settings(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      include: {
        organization: { select: { priceTiers: { orderBy: { name: "asc" }, select: { id: true, name: true, ticketPriceMinor: true, active: true } } } },
        taxRules: { orderBy: { name: "asc" } },
        serviceChargeRules: { orderBy: { name: "asc" } },
        promotions: { orderBy: { code: "asc" }, include: { ticketOrders: { where: { status: { in: ["PAID", "EXCHANGED"] } }, select: { discountCents: true, tickets: { select: { id: true } } } } } },
      },
    });
    const { organization, ...settings } = location;
    return { ...settings, priceTiers: organization.priceTiers, promotions: location.promotions.map(({ ticketOrders, ...promotion }) => ({ ...promotion, redemptionCount: ticketOrders.length, discountedTicketCount: ticketOrders.reduce((sum, order) => sum + order.tickets.length, 0), totalDiscountCents: ticketOrders.reduce((sum, order) => sum + order.discountCents, 0) })) };
  }

  async createPriceTier(input: { locationId: string; employeeId: string; name: string; ticketPriceMinor: number }) {
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true, organization: { select: { ticketFeeMinor: true } } } });
      const tier = await tx.priceTier.create({ data: { organizationId: location.organizationId, name: input.name, ticketPriceMinor: input.ticketPriceMinor, feeMinor: location.organization.ticketFeeMinor, appliesOnWeekdays: [] } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.price_tier_created", entityType: "PriceTier", entityId: tier.id, afterState: { name: tier.name, ticketPriceMinor: tier.ticketPriceMinor } } });
      return tier;
    });
  }

  async updatePriceTier(input: { locationId: string; employeeId: string; priceTierId: string; ticketPriceMinor: number; active?: boolean }) {
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { organizationId: true } });
      const before = await tx.priceTier.findFirst({ where: { id: input.priceTierId, organizationId: location.organizationId } });
      if (!before) throw AppError.notFound("Ticket price group not found.");
      const updated = await tx.priceTier.update({ where: { id: before.id }, data: { ticketPriceMinor: input.ticketPriceMinor, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.price_tier_updated", entityType: "PriceTier", entityId: updated.id, beforeState: { ticketPriceMinor: before.ticketPriceMinor, active: before.active }, afterState: { ticketPriceMinor: updated.ticketPriceMinor, active: updated.active } } });
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

  async createTaxRule(input: { locationId: string; employeeId: string; name: string; appliesTo: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille: number; active: boolean }) {
    return prisma.$transaction(async (tx) => {
      const rule = await tx.taxRule.create({ data: { locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "tax_rule.created", entityType: "TaxRule", entityId: rule.id, afterState: { name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, active: rule.active } } });
      return rule;
    });
  }

  async updateTaxRule(input: { locationId: string; employeeId: string; ruleId: string; name?: string; appliesTo?: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number; active?: boolean }) {
    const before = await prisma.taxRule.findFirst({ where: { id: input.ruleId, locationId: input.locationId } });
    if (!before) throw AppError.notFound("Tax rule was not found.");
    return prisma.$transaction(async (tx) => {
      const updated = await tx.taxRule.update({ where: { id: before.id }, data: { name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, active: input.active } });
      const state = (rule: typeof updated) => ({ name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, active: rule.active });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "tax_rule.updated", entityType: "TaxRule", entityId: updated.id, beforeState: state(before), afterState: state(updated) } });
      return updated;
    });
  }

  async createServiceCharge(input: { locationId: string; employeeId: string; name: string; appliesTo: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number; flatCents?: number; autoApply: boolean; active: boolean }) {
    if ((input.ratePermille == null) === (input.flatCents == null)) throw AppError.validationFailed("Provide exactly one percentage rate or flat amount.");
    return prisma.$transaction(async (tx) => {
      const rule = await tx.serviceChargeRule.create({ data: { locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, flatCents: input.flatCents, autoApply: input.autoApply, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "service_charge_rule.created", entityType: "ServiceChargeRule", entityId: rule.id, afterState: { name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, flatCents: rule.flatCents, autoApply: rule.autoApply, active: rule.active } } });
      return rule;
    });
  }

  async updateServiceCharge(input: { locationId: string; employeeId: string; ruleId: string; name?: string; appliesTo?: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number | null; flatCents?: number | null; autoApply?: boolean; active?: boolean }) {
    const before = await prisma.serviceChargeRule.findFirst({ where: { id: input.ruleId, locationId: input.locationId } });
    if (!before) throw AppError.notFound("Service-charge rule was not found.");
    const ratePermille = input.ratePermille === undefined ? before.ratePermille : input.ratePermille;
    const flatCents = input.flatCents === undefined ? before.flatCents : input.flatCents;
    if ((ratePermille == null) === (flatCents == null)) throw AppError.validationFailed("Provide exactly one percentage rate or flat amount.");
    return prisma.$transaction(async (tx) => {
      const updated = await tx.serviceChargeRule.update({ where: { id: before.id }, data: { name: input.name, appliesTo: input.appliesTo, ratePermille, flatCents, autoApply: input.autoApply, active: input.active } });
      const state = (rule: typeof updated) => ({ name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, flatCents: rule.flatCents, autoApply: rule.autoApply, active: rule.active });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "service_charge_rule.updated", entityType: "ServiceChargeRule", entityId: updated.id, beforeState: state(before), afterState: state(updated) } });
      return updated;
    });
  }

  async createPromotion(input: { locationId: string; employeeId: string; code: string; name: string; type: "FIXED_AMOUNT" | "PERCENTAGE" | "COMP"; amountCents?: number; percentageBasisPoints?: number; minimumSubtotalCents?: number; maximumRedemptions?: number; active: boolean; startsAt?: Date; endsAt?: Date }) {
    if (input.type === "FIXED_AMOUNT" && input.amountCents == null) throw AppError.validationFailed("A fixed promotion requires an amount.");
    if (input.type === "PERCENTAGE" && input.percentageBasisPoints == null) throw AppError.validationFailed("A percentage promotion requires a percentage.");
    return prisma.$transaction(async (tx) => {
      const promotion = await tx.promotion.create({ data: { locationId: input.locationId, code: input.code.toUpperCase(), name: input.name, type: input.type, amountCents: input.type === "FIXED_AMOUNT" ? input.amountCents : null, percentageBasisPoints: input.type === "PERCENTAGE" ? input.percentageBasisPoints : null, minimumSubtotalCents: input.minimumSubtotalCents, maximumRedemptions: input.maximumRedemptions, active: input.active, startsAt: input.startsAt, endsAt: input.endsAt } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "promotion.created", entityType: "Promotion", entityId: promotion.id, afterState: { code: promotion.code, name: promotion.name, type: promotion.type, amountCents: promotion.amountCents, percentageBasisPoints: promotion.percentageBasisPoints, minimumSubtotalCents: promotion.minimumSubtotalCents, maximumRedemptions: promotion.maximumRedemptions, active: promotion.active } } });
      return promotion;
    });
  }

  async updatePromotion(input: { locationId: string; employeeId: string; promotionId: string; code?: string; name?: string; type?: "FIXED_AMOUNT" | "PERCENTAGE" | "COMP"; amountCents?: number | null; percentageBasisPoints?: number | null; minimumSubtotalCents?: number | null; maximumRedemptions?: number | null; active?: boolean; startsAt?: Date | null; endsAt?: Date | null }) {
    const before = await prisma.promotion.findFirst({ where: { id: input.promotionId, locationId: input.locationId } });
    if (!before) throw AppError.notFound("Promotion was not found.");
    const type = input.type ?? before.type;
    const amountCents = input.amountCents === undefined ? before.amountCents : input.amountCents;
    const percentageBasisPoints = input.percentageBasisPoints === undefined ? before.percentageBasisPoints : input.percentageBasisPoints;
    if (type === "FIXED_AMOUNT" && amountCents == null) throw AppError.validationFailed("A fixed promotion requires an amount.");
    if (type === "PERCENTAGE" && percentageBasisPoints == null) throw AppError.validationFailed("A percentage promotion requires a percentage.");
    const startsAt = input.startsAt === undefined ? before.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? before.endsAt : input.endsAt;
    if (startsAt && endsAt && startsAt >= endsAt) throw AppError.validationFailed("Promotion end time must be after its start time.");
    return prisma.$transaction(async (tx) => {
      const updated = await tx.promotion.update({ where: { id: before.id }, data: { code: input.code?.toUpperCase(), name: input.name, type, amountCents: type === "FIXED_AMOUNT" ? amountCents : null, percentageBasisPoints: type === "PERCENTAGE" ? percentageBasisPoints : null, minimumSubtotalCents: input.minimumSubtotalCents, maximumRedemptions: input.maximumRedemptions, active: input.active, startsAt, endsAt } });
      const state = (promotion: typeof updated) => ({ code: promotion.code, name: promotion.name, type: promotion.type, amountCents: promotion.amountCents, percentageBasisPoints: promotion.percentageBasisPoints, minimumSubtotalCents: promotion.minimumSubtotalCents, maximumRedemptions: promotion.maximumRedemptions, active: promotion.active, startsAt: promotion.startsAt, endsAt: promotion.endsAt });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "promotion.updated", entityType: "Promotion", entityId: updated.id, beforeState: state(before), afterState: state(updated) } });
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

  async createEmployee(input: { locationId: string; employeeId: string; name: string; email: string; password: string; pin?: string; roleIds: string[] }) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const roleCount = await prisma.role.count({ where: { id: { in: input.roleIds }, organizationId: location.organizationId } });
    if (roleCount !== new Set(input.roleIds).size) throw AppError.notFound("One or more roles were not found.");
    const passwordHash = await hashPassword(input.password);
    const pinHash = input.pin ? await hashPin(input.pin) : undefined;
    return prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({ data: { locationId: input.locationId, name: input.name, email: input.email.toLowerCase(), authAccount: { create: { passwordHash, pinHash } }, employeeRoles: { create: [...new Set(input.roleIds)].map((roleId) => ({ roleId, locationId: input.locationId })) } }, select: { id: true, name: true, email: true, active: true } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "employee.created", entityType: "Employee", entityId: employee.id, afterState: { name: employee.name, email: employee.email, roleIds: input.roleIds } } });
      return employee;
    });
  }

  async updateEmployee(input: { locationId: string; actorId: string; targetId: string; name?: string; email?: string; active?: boolean; roleIds?: string[] }) {
    const target = await prisma.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId } });
    if (!target) throw AppError.notFound("Employee was not found.");
    const normalizedEmail = input.email?.toLowerCase();
    if (normalizedEmail) {
      const duplicate = await prisma.employee.findFirst({ where: { id: { not: target.id }, email: { equals: normalizedEmail, mode: "insensitive" } } });
      if (duplicate) throw AppError.conflict("An employee with that email already exists.");
    }
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    if (input.roleIds) {
      const roleCount = await prisma.role.count({ where: { id: { in: input.roleIds }, organizationId: location.organizationId } });
      if (roleCount !== new Set(input.roleIds).size) throw AppError.notFound("One or more roles were not found.");
    }
    return prisma.$transaction(async (tx) => {
      if (input.roleIds) {
        await tx.employeeRole.deleteMany({ where: { employeeId: target.id, locationId: input.locationId } });
        await tx.employeeRole.createMany({ data: [...new Set(input.roleIds)].map((roleId) => ({ employeeId: target.id, roleId, locationId: input.locationId })) });
      }
      const updated = await tx.employee.update({ where: { id: target.id }, data: { name: input.name, email: normalizedEmail, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.actorId, locationId: input.locationId, action: "employee.access_updated", entityType: "Employee", entityId: target.id, beforeState: { name: target.name, email: target.email, active: target.active }, afterState: { name: updated.name, email: updated.email, active: updated.active, roleIds: input.roleIds } } });
      return updated;
    });
  }

  async resetEmployeeCredentials(input: { locationId: string; actorId: string; targetId: string; password?: string; pin?: string | null; resetMfa?: boolean }) {
    const target = await prisma.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId }, include: { authAccount: true } });
    if (!target?.authAccount) throw AppError.notFound("Employee credentials were not found.");
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const pinHash = typeof input.pin === "string" ? await hashPin(input.pin) : input.pin === null ? null : undefined;
    const resetMfa = Boolean(input.password || input.resetMfa);
    await prisma.$transaction(async (tx) => {
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
        afterState: { passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, pinRemoved: input.pin === null, mustChangePassword: Boolean(input.password), mfaReset: resetMfa },
      } });
    });
    return { id: target.id, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, mustChangePassword: Boolean(input.password), mfaReset: resetMfa };
  }

  async createRole(input: { locationId: string; employeeId: string; name: string }) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const duplicate = await prisma.role.findFirst({ where: { organizationId: location.organizationId, name: { equals: input.name, mode: "insensitive" } } });
    if (duplicate) throw AppError.conflict("A role with that name already exists.");
    return prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { organizationId: location.organizationId, key: `CUSTOM_${randomUUID().replaceAll("-", "").toUpperCase()}`, name: input.name } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.created", entityType: "Role", entityId: role.id, afterState: { key: role.key, name: role.name, permissionKeys: [] } } });
      return { ...role, rolePermissions: [] };
    });
  }

  async updateRole(input: { locationId: string; employeeId: string; roleId: string; name: string }) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId: location.organizationId } });
    if (!role) throw AppError.notFound("Role was not found.");
    if (!role.key.startsWith("CUSTOM_")) throw AppError.forbidden("Built-in roles cannot be renamed.");
    const duplicate = await prisma.role.findFirst({ where: { organizationId: location.organizationId, id: { not: role.id }, name: { equals: input.name, mode: "insensitive" } } });
    if (duplicate) throw AppError.conflict("A role with that name already exists.");
    return prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({ where: { id: role.id }, data: { name: input.name } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "role.renamed", entityType: "Role", entityId: role.id, beforeState: { name: role.name }, afterState: { name: updated.name } } });
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
