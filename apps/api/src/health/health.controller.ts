import { Controller, Get } from "@nestjs/common";
import { prisma } from "@cinema/database";

@Controller("health")
export class HealthController {
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
}
