import { Injectable } from "@nestjs/common";
import { prisma, Shift } from "@cinema/database";
import { verifyPin } from "@cinema/auth";
import { AppError } from "../common/app-error";

interface PinInput {
  locationId: string;
  employeeId: string;
  pin: string;
}

@Injectable()
export class WorkforceService {
  async adjustShift(input: { shiftId: string; locationId: string; managerId: string; requestId: string; clockInAt?: string; clockOutAt?: string | null; breakStartAt?: string | null; breakEndAt?: string | null; notes: string }) {
    if (!input.requestId.trim()) throw AppError.validationFailed("An idempotency key is required.");
    const requestFingerprint = JSON.stringify({ shiftId: input.shiftId, locationId: input.locationId, clockInAt: input.clockInAt, clockOutAt: input.clockOutAt, breakStartAt: input.breakStartAt, breakEndAt: input.breakEndAt, notes: input.notes });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId: input.locationId, action: "shift.manager_adjusted", afterState: { path: ["requestId"], equals: input.requestId } } });
      if (replay) {
        const state = replay.afterState as (Shift & { requestFingerprint?: string }) | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The shift-adjustment idempotency key was already used with different details.");
        return { id: state.id, employeeId: state.employeeId, locationId: state.locationId, scheduledStartAt: state.scheduledStartAt ? new Date(state.scheduledStartAt) : null, scheduledEndAt: state.scheduledEndAt ? new Date(state.scheduledEndAt) : null, clockInAt: new Date(state.clockInAt), clockOutAt: state.clockOutAt ? new Date(state.clockOutAt) : null, clockInMethod: state.clockInMethod, breakStartAt: state.breakStartAt ? new Date(state.breakStartAt) : null, breakEndAt: state.breakEndAt ? new Date(state.breakEndAt) : null, adjustedByEmployeeId: state.adjustedByEmployeeId, notes: state.notes, createdAt: new Date(state.createdAt), updatedAt: new Date(state.updatedAt) };
      }
      await tx.$queryRaw`SELECT "id" FROM "shifts" WHERE "id" = ${input.shiftId} FOR UPDATE`;
      const shift = await tx.shift.findFirst({ where: { id: input.shiftId, locationId: input.locationId } });
      if (!shift) throw AppError.notFound("Shift was not found.");
      const clockInAt = input.clockInAt === undefined ? shift.clockInAt : new Date(input.clockInAt);
      const clockOutAt = input.clockOutAt === undefined ? shift.clockOutAt : input.clockOutAt ? new Date(input.clockOutAt) : null;
      const breakStartAt = input.breakStartAt === undefined ? shift.breakStartAt : input.breakStartAt ? new Date(input.breakStartAt) : null;
      const breakEndAt = input.breakEndAt === undefined ? shift.breakEndAt : input.breakEndAt ? new Date(input.breakEndAt) : null;
      if (clockOutAt && clockOutAt < clockInAt) throw AppError.validationFailed("Clock-out cannot be before clock-in.");
      if (breakStartAt && breakStartAt < clockInAt) throw AppError.validationFailed("Break start cannot be before clock-in.");
      if (breakEndAt && (!breakStartAt || breakEndAt < breakStartAt)) throw AppError.validationFailed("Break end cannot be before break start.");
      if (clockOutAt && breakStartAt && breakStartAt > clockOutAt) throw AppError.validationFailed("Break start cannot be after clock-out.");
      if (clockOutAt && breakEndAt && breakEndAt > clockOutAt) throw AppError.validationFailed("Break end cannot be after clock-out.");
      const updated = await tx.shift.update({ where: { id: shift.id }, data: {
        ...(input.clockInAt !== undefined ? { clockInAt: new Date(input.clockInAt) } : {}),
        ...(input.clockOutAt !== undefined ? { clockOutAt: input.clockOutAt ? new Date(input.clockOutAt) : null } : {}),
        ...(input.breakStartAt !== undefined ? { breakStartAt: input.breakStartAt ? new Date(input.breakStartAt) : null } : {}),
        ...(input.breakEndAt !== undefined ? { breakEndAt: input.breakEndAt ? new Date(input.breakEndAt) : null } : {}),
        adjustedByEmployeeId: input.managerId, notes: input.notes,
      } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.managerId, locationId: input.locationId, action: "shift.manager_adjusted", entityType: "Shift", entityId: shift.id, beforeState: shift, afterState: { ...updated, requestId: input.requestId, requestFingerprint } } });
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
      await tx.$queryRaw`SELECT "id" FROM "employees" WHERE "id" = ${employee.id} FOR UPDATE`;
      const shift = await tx.shift.findFirst({
        where: { employeeId: employee.id, locationId: input.locationId, clockOutAt: null },
        orderBy: { clockInAt: "desc" },
      });
      if (!shift) throw AppError.conflict("This employee is not clocked in.");
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
      await tx.$queryRaw`SELECT "id" FROM "employees" WHERE "id" = ${employee.id} FOR UPDATE`;
      const shift = await tx.shift.findFirst({
        where: { employeeId: employee.id, locationId: input.locationId, clockOutAt: null },
        orderBy: { clockInAt: "desc" },
      });
      if (!shift) throw AppError.conflict("This employee is not clocked in.");
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

  private audit(client: { auditEvent: typeof prisma.auditEvent }, actorId: string, locationId: string, action: string, entityId: string, beforeState: unknown, afterState: unknown) {
    return client.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId, locationId, action, entityType: "Shift", entityId, beforeState: beforeState as object | undefined, afterState: afterState as object } });
  }
}
