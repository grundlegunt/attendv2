import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnv } from "@cinema/config/env";
import { Request } from "express";
import Redis from "ioredis";
import { AppError } from "./app-error";

interface RateLimitPolicy {
  scope: "auth" | "checkout" | "observability" | "analytics";
  identity?: "email" | "actor";
}

const RATE_LIMIT_POLICY = Symbol("rate-limit-policy");
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY, policy);

@Injectable()
export class RequestRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly env = loadEnv();
  private readonly redis = this.env.NODE_ENV === "test" ? null : new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  private readonly fallback = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.get<RateLimitPolicy>(RATE_LIMIT_POLICY, context.getHandler());
    if (!policy) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const limit = policy.scope === "auth" ? this.env.AUTH_RATE_LIMIT_ATTEMPTS : policy.scope === "observability" ? 10 : policy.scope === "analytics" ? 120 : this.env.CHECKOUT_RATE_LIMIT_ATTEMPTS;
    const windowSeconds = policy.scope === "auth" ? this.env.AUTH_RATE_LIMIT_WINDOW_SECONDS : policy.scope === "observability" || policy.scope === "analytics" ? 60 : this.env.CHECKOUT_RATE_LIMIT_WINDOW_SECONDS;
    const route = `${request.baseUrl}${request.route?.path ?? request.path}`;
    const keys = [`rate:${policy.scope}:ip:${route}:${request.ip}`];
    const identity = this.identity(request, policy.identity);
    if (identity) keys.push(`rate:${policy.scope}:identity:${route}:${identity}`);
    const counts = await Promise.all(keys.map((key) => this.increment(key, windowSeconds)));
    if (counts.some((count) => count > limit)) throw AppError.rateLimited(`Too many ${policy.scope} attempts. Wait briefly and try again.`);
    return true;
  }

  private identity(request: Request, kind?: RateLimitPolicy["identity"]) {
    if (kind === "email" && typeof request.body?.email === "string") return request.body.email.trim().toLowerCase();
    if (kind === "actor") return request.actor?.sub;
    return undefined;
  }

  private async increment(key: string, windowSeconds: number) {
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, windowSeconds + 1);
        return count;
      } catch (error) {
        // Continue with per-instance protection; emit a machine-queryable
        // event so operations can alert on loss of shared enforcement.
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({ event: "security.rate_limit_redis_unavailable", scope: key.split(":")[1], error: error instanceof Error ? error.message : "Unknown Redis error" }));
      }
    }
    const now = Date.now();
    const bucket = this.fallback.get(key);
    if (!bucket || bucket.expiresAt <= now) { this.fallback.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 }); return 1; }
    bucket.count += 1;
    return bucket.count;
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status !== "end") await this.redis.quit();
  }
}
