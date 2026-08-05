import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { prisma } from "@cinema/database";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";

/**
 * Deliberately thin in Milestone 0 — exists to prove the RBAC guard
 * framework actually enforces something real end to end (not just wired
 * and untested), per IMPLEMENTATION_PLAN.md Milestone 0. Full audit
 * filtering/reporting UX is Milestone 10.
 */
@Controller("audit-events")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  @Get()
  @RequirePermissions(Permission.AuditLogView)
  async list(@CurrentActor() _actor: RequestActor, @Query("limit") limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    return prisma.auditEvent.findMany({
      where: { locationId: _actor.locationId },
      orderBy: { occurredAt: "desc" },
      take,
    });
  }
}
