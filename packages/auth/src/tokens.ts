import jwt from "jsonwebtoken";

/**
 * JWT issuance/verification for both staff and customer sessions. Uses the
 * standard `jsonwebtoken` library (HS256) rather than any custom scheme —
 * per /docs/SECURITY.md §1, no home-grown cryptography.
 *
 * Access tokens are short-lived and carry the actor's permission set so the
 * API's RBAC guard can authorize a request without a database round trip on
 * every call. Refresh tokens are long-lived, carry only identity plus a
 * `tokenVersion`, and are checked against the stored `refreshTokenVersion`
 * on the corresponding auth-account row — bumping that column invalidates
 * every outstanding refresh token at once (logout-everywhere / compromised
 * session response).
 */

export type ActorType = "EMPLOYEE" | "CUSTOMER" | "PLATFORM";

export interface AccessTokenPayload {
  sub: string; // Employee.id, Customer.id, or PlatformUser.id
  actorType: ActorType;
  tokenVersion?: number; // required for staff and customers so access tokens can be revoked
  locationId?: string; // present for employee tokens
  permissions: string[]; // flattened Permission keys, empty for customers
  supportSession?: boolean;
}

export interface RefreshTokenPayload {
  sub: string;
  actorType: ActorType;
  tokenVersion: number;
}

export interface CustomerPasswordResetPayload {
  sub: string;
  tokenVersion: number;
  purpose: "customer-password-reset";
}

export interface CustomerEmailChangePayload {
  sub: string;
  tokenVersion: number;
  newEmail: string;
  purpose: "customer-email-change";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface SignOptions {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export function signTokenPair(
  accessPayload: AccessTokenPayload,
  refreshPayload: RefreshTokenPayload,
  options: SignOptions,
): TokenPair {
  const accessToken = jwt.sign(accessPayload, options.accessSecret, {
    expiresIn: options.accessTtlSeconds,
    issuer: "cinema-platform",
  });
  const refreshToken = jwt.sign(refreshPayload, options.refreshSecret, {
    expiresIn: options.refreshTtlSeconds,
    issuer: "cinema-platform",
  });
  return { accessToken, refreshToken };
}

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid token: ${reason}`);
    this.name = "InvalidTokenError";
  }
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, secret, { issuer: "cinema-platform" });
    return decoded as unknown as AccessTokenPayload;
  } catch (err) {
    throw new InvalidTokenError(err instanceof Error ? err.message : "unknown");
  }
}

export function verifyRefreshToken(token: string, secret: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, secret, { issuer: "cinema-platform" });
    return decoded as unknown as RefreshTokenPayload;
  } catch (err) {
    throw new InvalidTokenError(err instanceof Error ? err.message : "unknown");
  }
}

export function signCustomerPasswordResetToken(
  payload: CustomerPasswordResetPayload,
  secret: string,
  ttlSeconds = 30 * 60,
): string {
  return jwt.sign(payload, secret, {
    expiresIn: ttlSeconds,
    issuer: "cinema-platform",
    audience: "customer-password-reset",
  });
}

export function verifyCustomerPasswordResetToken(
  token: string,
  secret: string,
): CustomerPasswordResetPayload {
  try {
    const decoded = jwt.verify(token, secret, {
      issuer: "cinema-platform",
      audience: "customer-password-reset",
    }) as unknown as CustomerPasswordResetPayload;
    if (decoded.purpose !== "customer-password-reset") {
      throw new Error("incorrect token purpose");
    }
    return decoded;
  } catch (err) {
    throw new InvalidTokenError(err instanceof Error ? err.message : "unknown");
  }
}

export function signCustomerEmailChangeToken(
  payload: CustomerEmailChangePayload,
  secret: string,
  ttlSeconds = 30 * 60,
): string {
  return jwt.sign(payload, secret, {
    expiresIn: ttlSeconds,
    issuer: "cinema-platform",
    audience: "customer-email-change",
  });
}

export function verifyCustomerEmailChangeToken(
  token: string,
  secret: string,
): CustomerEmailChangePayload {
  try {
    const decoded = jwt.verify(token, secret, {
      issuer: "cinema-platform",
      audience: "customer-email-change",
    }) as unknown as CustomerEmailChangePayload;
    if (decoded.purpose !== "customer-email-change" || typeof decoded.newEmail !== "string") {
      throw new Error("incorrect token purpose or payload");
    }
    return decoded;
  } catch (err) {
    throw new InvalidTokenError(err instanceof Error ? err.message : "unknown");
  }
}
