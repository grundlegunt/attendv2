import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { Request } from "express";
import Redis from "ioredis";
import { AppError } from "../common/app-error";

const LIMIT = 10;
const WINDOW_SECONDS = 5 * 60;

@Injectable()
export class WorkforceRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly redis: Redis | null;
  private readonly fallback = new Map<string, number>();

  constructor() {
    const env = loadEnv();
    this.redis = env.NODE_ENV === "test" ? null : new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const employeeId = typeof request.body?.employeeId === "string" ? request.body.employeeId : "unknown";
    const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `rate:workforce-pin:${employeeId}:${request.ip}:${window}`;
    let count: number;
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, WINDOW_SECONDS + 1);
      } catch {
        count = this.increment(key);
      }
    } else count = this.increment(key);
    if (count > LIMIT) throw AppError.rateLimited("Too many PIN attempts. Wait five minutes and try again.");
    return true;
  }

  private increment(key: string) {
    const count = (this.fallback.get(key) ?? 0) + 1;
    this.fallback.set(key, count);
    return count;
  }

  resetForTests() {
    if (process.env.NODE_ENV === "test") this.fallback.clear();
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status !== "end") await this.redis.quit();
  }
}
