import { Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import { verifyPin } from "@cinema/auth";
import { AppError } from "../common/app-error";

interface PinInput {
  locationId: string;
  employeeId: string;
  pin: string;
}

@Injectable()
export class WorkforceService {
  async adjustShift(input: { shiftId: string; locationId: string; managerId: string; clockInAt?: string; clockOutAt?: string | null; breakStartAt?: string | null; breakEndAt?: string | null; notes: string }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "shifts" WHERE "id" = ${input.shiftId} FOR UPDATE`;
      const shift = await tx.shift.findFirst({ where: { id: input.shiftId, locationId: input.locationId } });
      if (!shift) throw AppError.notFound("Shift was not found.");
      const updated = await tx.shift.update({ where: { id: shift.id }, data: {
        ...(input.clockInAt !== undefined ? { clockInAt: new Date(input.clockInAt) } : {}),
        ...(input.clockOutAt !== undefined ? { clockOutAt: input.clockOutAt ? new Date(input.clockOutAt) : null } : {}),
        ...(input.breakStartAt !== undefined ? { breakStartAt: input.breakStartAt ? new Date(input.breakStartAt) : null } : {}),
        ...(input.breakEndAt !== undefined ? { breakEndAt: input.breakEndAt ? new Date(input.breakEndAt) : null } : {}),
        adjustedByEmployeeId: input.managerId, notes: input.notes,
      } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.managerId, locationId: input.locationId, action: "shift.manager_adjusted", entityType: "Shift", entityId: shift.id, beforeState: shift, afterState: updated } });
      return updated;
    });
  }

  async status(input: PinInput) {
    const employee = await this.verifyPin(input);
    const shift = await this.activeShift(employee.id, input.locationId);
    return { employee: { id: employee.id, name: employee.name }, shift };
  }

  async clockIn(input: PinInput & { requestId: string }) {
    const employee = await this.verifyPin(input);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "employees" WHERE "id" = ${employee.id} FOR UPDATE`;
      const existing = await tx.shift.findFirst({
        where: { employeeId: employee.id, locationId: input.locationId, clockOutAt: null },
      });
      if (existing) {
        const completed = await tx.auditEvent.findFirst({
          where: { locationId: input.locationId, action: "shift.clocked_in", entityType: "Shift", entityId: existing.id },
          orderBy: { occurredAt: "desc" },
          select: { afterState: true },
        });
        const receipt = completed?.afterState && typeof completed.afterState === "object" && !Array.isArray(completed.afterState)
          ? completed.afterState as Record<string, unknown>
          : undefined;
        if (receipt?.requestId === input.requestId) return existing;
        throw AppError.conflict("This employee is already clocked in.");
      }
      const shift = await tx.shift.create({
        data: { employeeId: employee.id, locationId: input.locationId, clockInAt: new Date(), clockInMethod: "PIN" },
      });
      await this.audit(tx, employee.id, input.locationId, "shift.clocked_in", shift.id, null, { ...shift, requestId: input.requestId });
      return shift;
    });
  }

  async startBreak(input: PinInput & { requestId: string }) {
    const employee = await this.verifyPin(input);
    return prisma.$transaction(async (tx) => {
      const active = await this.requireActiveShift(employee.id, input.locationId);
      await tx.$queryRaw`SELECT "id" FROM "shifts" WHERE "id" = ${active.id} FOR UPDATE`;
      const shift = await tx.shift.findUniqueOrThrow({ where: { id: active.id } });
      if (shift.breakStartAt && !shift.breakEndAt) {
        const completed = await tx.auditEvent.findFirst({
          where: { locationId: input.locationId, action: "shift.break_started", entityType: "Shift", entityId: shift.id },
          orderBy: { occurredAt: "desc" },
          select: { afterState: true },
        });
        const receipt = completed?.afterState && typeof completed.afterState === "object" && !Array.isArray(completed.afterState)
          ? completed.afterState as Record<string, unknown>
          : undefined;
        if (receipt?.requestId === input.requestId) return shift;
        throw AppError.conflict("A break is already active.");
      }
      const updated = await tx.shift.update({
        where: { id: shift.id }, data: { breakStartAt: new Date(), breakEndAt: null },
      });
      await this.audit(tx, employee.id, input.locationId, "shift.break_started", shift.id, shift, { ...updated, requestId: input.requestId });
      return updated;
    });
  }

  async endBreak(input: PinInput & { requestId: string }) {
    const employee = await this.verifyPin(input);
    return prisma.$transaction(async (tx) => {
      const active = await this.requireActiveShift(employee.id, input.locationId);
      await tx.$queryRaw`SELECT "id" FROM "shifts" WHERE "id" = ${active.id} FOR UPDATE`;
      const shift = await tx.shift.findUniqueOrThrow({ where: { id: active.id } });
      if (!shift.breakStartAt || shift.breakEndAt) {
        const completed = await tx.auditEvent.findFirst({
          where: { locationId: input.locationId, action: "shift.break_ended", entityType: "Shift", entityId: shift.id },
          orderBy: { occurredAt: "desc" },
          select: { afterState: true },
        });
        const receipt = completed?.afterState && typeof completed.afterState === "object" && !Array.isArray(completed.afterState)
          ? completed.afterState as Record<string, unknown>
          : undefined;
        if (receipt?.requestId === input.requestId) return shift;
        throw AppError.conflict("No break is active.");
      }
      const updated = await tx.shift.update({ where: { id: shift.id }, data: { breakEndAt: new Date() } });
      await this.audit(tx, employee.id, input.locationId, "shift.break_ended", shift.id, shift, { ...updated, requestId: input.requestId });
      return updated;
    });
  }

  async clockOut(input: PinInput & { requestId: string }) {
    const employee = await this.verifyPin(input);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "employees" WHERE "id" = ${employee.id} FOR UPDATE`;
      const active = await tx.shift.findFirst({
        where: { employeeId: employee.id, locationId: input.locationId, clockOutAt: null },
        orderBy: { clockInAt: "desc" },
      });
      if (!active) {
        const latest = await tx.shift.findFirst({
          where: { employeeId: employee.id, locationId: input.locationId, clockOutAt: { not: null } },
          orderBy: { clockOutAt: "desc" },
        });
        const completed = latest ? await tx.auditEvent.findFirst({
          where: { locationId: input.locationId, action: "shift.clocked_out", entityType: "Shift", entityId: latest.id },
          orderBy: { occurredAt: "desc" },
          select: { afterState: true },
        }) : null;
        const receipt = completed?.afterState && typeof completed.afterState === "object" && !Array.isArray(completed.afterState)
          ? completed.afterState as Record<string, unknown>
          : undefined;
        if (latest && receipt?.requestId === input.requestId) return latest;
        throw AppError.conflict("This employee is not clocked in.");
      }
      if (active.breakStartAt && !active.breakEndAt) throw AppError.conflict("End the active break before clocking out.");
      const updated = await tx.shift.update({ where: { id: active.id }, data: { clockOutAt: new Date() } });
      await this.audit(tx, employee.id, input.locationId, "shift.clocked_out", active.id, active, { ...updated, requestId: input.requestId });
      return updated;
    });
  }

  private async verifyPin(input: PinInput) {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, locationId: input.locationId, active: true },
      include: { location: true, authAccount: true },
    });
    if (!employee?.location.timeClockEnabled) throw AppError.forbidden("The time clock is disabled at this location.");
    if (!employee.authAccount?.pinHash || !(await verifyPin(employee.authAccount.pinHash, input.pin))) {
      throw AppError.invalidCredentials("Invalid employee or PIN.");
    }
    return employee;
  }

  private activeShift(employeeId: string, locationId: string) {
    return prisma.shift.findFirst({ where: { employeeId, locationId, clockOutAt: null }, orderBy: { clockInAt: "desc" } });
  }

  private async requireActiveShift(employeeId: string, locationId: string) {
    const shift = await this.activeShift(employeeId, locationId);
    if (!shift) throw AppError.conflict("This employee is not clocked in.");
    return shift;
  }

  private audit(client: { auditEvent: typeof prisma.auditEvent }, actorId: string, locationId: string, action: string, entityId: string, beforeState: unknown, afterState: unknown) {
    return client.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId, locationId, action, entityType: "Shift", entityId, beforeState: beforeState as object | undefined, afterState: afterState as object } });
  }
}
