import { Injectable } from "@nestjs/common";
import { hashPassword, hashPin, Permission as PermissionKey } from "@cinema/auth";
import { prisma } from "@cinema/database";
import { AppError } from "../common/app-error";

@Injectable()
export class ManagementService {
  async settings(locationId: string) {
    return prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { id: true, name: true, customerLogoUrl: true, customerAccentColor: true, customerAccentMutedColor: true, customerBackgroundColor: true, customerBackgroundGlowColor: true, customerSurfaceColor: true, customerTextColor: true, customerMutedTextColor: true, adminAccentColor: true, adminAccentMutedColor: true, adminBackgroundColor: true, adminSurfaceColor: true, adminTextColor: true, adminMutedTextColor: true, timeClockEnabled: true, ticketTaxRateBasisPoints: true, taxRules: { orderBy: { name: "asc" } }, serviceChargeRules: { orderBy: { name: "asc" } }, promotions: { orderBy: { code: "asc" } } },
    });
  }

  async updateLocation(input: { locationId: string; employeeId: string; timeClockEnabled?: boolean; ticketTaxRateBasisPoints?: number }) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
      const updated = await tx.location.update({ where: { id: input.locationId }, data: {
        timeClockEnabled: input.timeClockEnabled, ticketTaxRateBasisPoints: input.ticketTaxRateBasisPoints,
      } });
      const settingsState = (location: typeof updated) => ({ timeClockEnabled: location.timeClockEnabled, ticketTaxRateBasisPoints: location.ticketTaxRateBasisPoints });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "location.settings_updated", entityType: "Location", entityId: input.locationId, beforeState: settingsState(before), afterState: settingsState(updated) } });
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

  async createServiceCharge(input: { locationId: string; employeeId: string; name: string; appliesTo: "ALL" | "FOOD" | "ALCOHOL" | "NA_BEVERAGE"; ratePermille?: number; flatCents?: number; autoApply: boolean; active: boolean }) {
    if ((input.ratePermille == null) === (input.flatCents == null)) throw AppError.validationFailed("Provide exactly one percentage rate or flat amount.");
    return prisma.$transaction(async (tx) => {
      const rule = await tx.serviceChargeRule.create({ data: { locationId: input.locationId, name: input.name, appliesTo: input.appliesTo, ratePermille: input.ratePermille, flatCents: input.flatCents, autoApply: input.autoApply, active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "service_charge_rule.created", entityType: "ServiceChargeRule", entityId: rule.id, afterState: { name: rule.name, appliesTo: rule.appliesTo, ratePermille: rule.ratePermille, flatCents: rule.flatCents, autoApply: rule.autoApply, active: rule.active } } });
      return rule;
    });
  }

  async createPromotion(input: { locationId: string; employeeId: string; code: string; name: string; type: "FIXED_AMOUNT" | "PERCENTAGE" | "COMP"; amountCents?: number; percentageBasisPoints?: number; active: boolean; startsAt?: Date; endsAt?: Date }) {
    if (input.type === "FIXED_AMOUNT" && input.amountCents == null) throw AppError.validationFailed("A fixed promotion requires an amount.");
    if (input.type === "PERCENTAGE" && input.percentageBasisPoints == null) throw AppError.validationFailed("A percentage promotion requires a percentage.");
    return prisma.$transaction(async (tx) => {
      const promotion = await tx.promotion.create({ data: { locationId: input.locationId, code: input.code.toUpperCase(), name: input.name, type: input.type, amountCents: input.type === "FIXED_AMOUNT" ? input.amountCents : null, percentageBasisPoints: input.type === "PERCENTAGE" ? input.percentageBasisPoints : null, active: input.active, startsAt: input.startsAt, endsAt: input.endsAt } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "promotion.created", entityType: "Promotion", entityId: promotion.id, afterState: { code: promotion.code, name: promotion.name, type: promotion.type, amountCents: promotion.amountCents, percentageBasisPoints: promotion.percentageBasisPoints, active: promotion.active } } });
      return promotion;
    });
  }

  async people(locationId: string) {
    const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const [employees, roles, permissions] = await Promise.all([
      prisma.employee.findMany({ where: { locationId }, select: { id: true, name: true, email: true, active: true, employeeRoles: { where: { locationId }, select: { roleId: true, role: { select: { key: true, name: true } } } } }, orderBy: { name: "asc" } }),
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

  async updateEmployee(input: { locationId: string; actorId: string; targetId: string; active?: boolean; roleIds?: string[] }) {
    const target = await prisma.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId } });
    if (!target) throw AppError.notFound("Employee was not found.");
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
      const updated = await tx.employee.update({ where: { id: target.id }, data: { active: input.active } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.actorId, locationId: input.locationId, action: "employee.access_updated", entityType: "Employee", entityId: target.id, beforeState: { active: target.active }, afterState: { active: updated.active, roleIds: input.roleIds } } });
      return updated;
    });
  }

  async resetEmployeeCredentials(input: { locationId: string; actorId: string; targetId: string; password?: string; pin?: string | null }) {
    const target = await prisma.employee.findFirst({ where: { id: input.targetId, locationId: input.locationId }, include: { authAccount: true } });
    if (!target?.authAccount) throw AppError.notFound("Employee credentials were not found.");
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const pinHash = typeof input.pin === "string" ? await hashPin(input.pin) : input.pin === null ? null : undefined;
    await prisma.$transaction(async (tx) => {
      await tx.staffAuthAccount.update({ where: { employeeId: target.id }, data: {
        passwordHash,
        pinHash,
        mustChangePassword: input.password ? true : undefined,
        refreshTokenVersion: { increment: 1 },
      } });
      await tx.auditEvent.create({ data: {
        actorType: "EMPLOYEE", actorId: input.actorId, locationId: input.locationId,
        action: "employee.credentials_reset", entityType: "Employee", entityId: target.id,
        afterState: { passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, pinRemoved: input.pin === null, mustChangePassword: Boolean(input.password) },
      } });
    });
    return { id: target.id, passwordReset: Boolean(input.password), pinReset: input.pin !== undefined, mustChangePassword: Boolean(input.password) };
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
