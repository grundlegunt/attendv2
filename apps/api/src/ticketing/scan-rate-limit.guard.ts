import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import Redis from "ioredis";
import { Request } from "express";
import { AppError } from "../common/app-error";

const LIMIT = 60;
const WINDOW_SECONDS = 60;

@Injectable()
export class ScanRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly redis: Redis | null;
  private readonly testBuckets = new Map<string, number>();

  constructor() {
    const env = loadEnv();
    this.redis = env.NODE_ENV === "test"
      ? null
      : new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const actorId = request.actor?.sub;
    if (!actorId) throw AppError.unauthenticated();
    const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `rate:ticket-scan:${actorId}:${request.ip}:${window}`;

    let count: number;
    if (this.redis) {
      if (this.redis.status === "wait") await this.redis.connect();
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, WINDOW_SECONDS + 1);
    } else {
      count = (this.testBuckets.get(key) ?? 0) + 1;
      this.testBuckets.set(key, count);
    }

    if (count > LIMIT) {
      throw AppError.rateLimited("Ticket scanner rate limit exceeded. Wait briefly and retry.");
    }
    return true;
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status !== "end") await this.redis.quit();
  }
}
