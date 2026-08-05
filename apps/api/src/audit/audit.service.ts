import { Injectable } from "@nestjs/common";
import { AuditActorType, Prisma, prisma } from "@cinema/database";

export interface RecordAuditEventInput {
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  locationId?: string;
  beforeState?: Prisma.InputJsonObject;
  afterState?: Prisma.InputJsonObject;
}

/**
 * The only way an AuditEvent row is ever created. Per AGENTS.md §6 /
 * SECURITY.md §9: audit writes happen inside the same transaction as the
 * action they record wherever the caller passes a transactional client,
 * and never contain payment credentials — callers are responsible for only
 * passing display-safe before/after state.
 */
@Injectable()
export class AuditService {
  async record(input: RecordAuditEventInput, client: Pick<Prisma.TransactionClient, "auditEvent"> = prisma) {
    await client.auditEvent.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        locationId: input.locationId,
        beforeState: input.beforeState,
        afterState: input.afterState,
      },
    });
  }
}
