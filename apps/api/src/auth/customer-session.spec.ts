import type { Request } from "express";
import {
  assertTrustedCustomerOrigin,
  customerAccessCookieOptions,
  customerRefreshCookieOptions,
  isUnsafeMethod,
  readCookie,
} from "./customer-session";

const baseEnv = {
  NODE_ENV: "test" as const,
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 1_209_600,
  CORS_ORIGINS: "http://localhost:3000,https://cinema.example",
};

describe("customer session cookies", () => {
  it("uses HttpOnly, non-Secure Lax cookies locally with least-privilege paths", () => {
    expect(customerAccessCookieOptions(baseEnv)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 900_000,
      path: "/api/v1",
    });
    expect(customerRefreshCookieOptions(baseEnv)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 1_209_600_000,
      path: "/api/v1/auth/customers",
    });
  });

  it("uses Secure SameSite=None cookies for the cross-site production deployment", () => {
    const productionEnv = { ...baseEnv, NODE_ENV: "production" as const };
    expect(customerAccessCookieOptions(productionEnv)).toMatchObject({ secure: true, sameSite: "none" });
    expect(customerRefreshCookieOptions(productionEnv)).toMatchObject({ secure: true, sameSite: "none" });
  });

  it("reads only the named cookie and classifies unsafe methods", () => {
    const request = { headers: { cookie: "other=value; attend_customer_access=jwt.value; empty=" } } as Request;
    expect(readCookie(request, "attend_customer_access")).toBe("jwt.value");
    expect(readCookie(request, "missing")).toBeUndefined();
    expect(isUnsafeMethod("GET")).toBe(false);
    expect(isUnsafeMethod("POST")).toBe(true);
  });

  it("allows configured browser origins and rejects foreign origins", () => {
    expect(() => assertTrustedCustomerOrigin(
      { headers: { origin: "https://cinema.example" } } as Request,
      baseEnv,
    )).not.toThrow();
    expect(() => assertTrustedCustomerOrigin(
      { headers: { origin: "https://attacker.example" } } as Request,
      baseEnv,
    )).toThrow("Request origin is not allowed.");
  });
});
