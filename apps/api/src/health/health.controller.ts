import { Controller, Get, Headers, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@cinema/database";
import { loadEnv } from "@cinema/config/env";
import Redis from "ioredis";
import { AppError } from "../common/app-error";

@Controller("health")
export class HealthController implements OnModuleDestroy {
  private readonly env = loadEnv();
  private readonly redis = this.env.NODE_ENV === "test" ? null : new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });

  /**
   * Unauthenticated liveness/readiness check. Confirms the process is up
   * AND that it can reach the database — a "the API is running but the DB
   * is unreachable" state should not report healthy.
   */
  @Get()
  async check() {
    let databaseOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseOk = true;
    } catch {
      databaseOk = false;
    }

    return {
      status: databaseOk ? "ok" : "degraded",
      time: new Date().toISOString(),
      database: databaseOk ? "connected" : "unreachable",
    };
  }

  @Get("live")
  live() {
    return { status: "ok", time: new Date().toISOString() };
  }

  @Get("ready")
  async ready() {
    const database = await this.databaseAvailable();
    const redis = await this.redisAvailable();
    if (!database || !redis) throw new ServiceUnavailableException("A required dependency is unavailable.");
    return { status: "ok", time: new Date().toISOString(), database: "connected", redis: this.redis ? "connected" : "not-required-in-tests" };
  }

  @Get("operations")
  async operations(@Headers("authorization") authorization?: string) {
    const expected = this.env.OBSERVABILITY_TOKEN;
    if (!expected || authorization !== `Bearer ${expected}`) throw AppError.unauthenticated("A valid observability token is required.");
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const [failedPayments15m, stalePayments, staleRefunds, managerReviewTabs, expiredHoldBacklog, attentionEvents15m] = await Promise.all([
      prisma.payment.count({ where: { status: "FAILED", updatedAt: { gte: new Date(Date.now() - 15 * 60_000) } } }),
      prisma.payment.count({ where: { status: { in: ["PROCESSING", "AUTHORIZED"] }, updatedAt: { lt: staleBefore } } }),
      prisma.refund.count({ where: { status: { in: ["CREATED", "PROCESSING"] }, updatedAt: { lt: staleBefore } } }),
      prisma.restaurantTab.count({ where: { status: "MANAGER_REVIEW" } }),
      prisma.seatHold.count({ where: { releasedAt: null, expiresAt: { lt: new Date() } } }),
      prisma.auditEvent.count({ where: { action: { contains: "attention_required" }, occurredAt: { gte: new Date(Date.now() - 15 * 60_000) } } }),
    ]);
    return { time: new Date().toISOString(), failedPayments15m, stalePayments, staleRefunds, managerReviewTabs, expiredHoldBacklog, attentionEvents15m };
  }

  private async databaseAvailable() {
    try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
  }

  private async redisAvailable() {
    if (!this.redis) return true;
    try { if (this.redis.status === "wait") await this.redis.connect(); return (await this.redis.ping()) === "PONG"; } catch { return false; }
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status !== "end") await this.redis.quit();
  }
}
