import type { CookieOptions, Request, Response } from "express";
import type { TokenPair } from "@cinema/auth";
import type { Env } from "@cinema/config/env";
import { loadEnv } from "@cinema/config/env";
import { AppError } from "../common/app-error";
import { isCorsOriginAllowed } from "../common/cors-origin";

export const CUSTOMER_ACCESS_COOKIE = "attend_customer_access";
export const CUSTOMER_REFRESH_COOKIE = "attend_customer_refresh";

type CustomerSessionEnv = Pick<
  Env,
  "NODE_ENV" | "JWT_ACCESS_TTL_SECONDS" | "JWT_REFRESH_TTL_SECONDS" | "CORS_ORIGINS"
>;

function cookieOptions(env: CustomerSessionEnv, maxAge: number, path: string): CookieOptions {
  const production = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    maxAge,
    path,
  };
}

export function customerAccessCookieOptions(env: CustomerSessionEnv): CookieOptions {
  return cookieOptions(env, env.JWT_ACCESS_TTL_SECONDS * 1_000, "/api/v1");
}

export function customerRefreshCookieOptions(env: CustomerSessionEnv): CookieOptions {
  return cookieOptions(env, env.JWT_REFRESH_TTL_SECONDS * 1_000, "/api/v1/auth/customers");
}

export function setCustomerSessionCookies(
  response: Response,
  tokens: TokenPair,
  env: CustomerSessionEnv = loadEnv(),
): void {
  response.cookie(CUSTOMER_ACCESS_COOKIE, tokens.accessToken, customerAccessCookieOptions(env));
  response.cookie(CUSTOMER_REFRESH_COOKIE, tokens.refreshToken, customerRefreshCookieOptions(env));
}

export function clearCustomerSessionCookies(
  response: Response,
  env: CustomerSessionEnv = loadEnv(),
): void {
  const production = env.NODE_ENV === "production";
  const sharedOptions: CookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
  };
  response.clearCookie(CUSTOMER_ACCESS_COOKIE, { ...sharedOptions, path: "/api/v1" });
  response.clearCookie(CUSTOMER_REFRESH_COOKIE, { ...sharedOptions, path: "/api/v1/auth/customers" });
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

export function requireCustomerRefreshToken(request: Request): string {
  const token = readCookie(request, CUSTOMER_REFRESH_COOKIE);
  if (!token) throw AppError.unauthenticated("Customer session has expired. Please sign in again.");
  return token;
}

export function assertTrustedCustomerOrigin(
  request: Request,
  env: CustomerSessionEnv = loadEnv(),
): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const configuredOrigins = env.CORS_ORIGINS.split(",").map((entry) => entry.trim());
  if (!isCorsOriginAllowed(origin, configuredOrigins)) {
    throw AppError.forbidden("Request origin is not allowed.");
  }
}

export function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}
