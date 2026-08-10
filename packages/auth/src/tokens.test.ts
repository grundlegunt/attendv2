import { signTokenPair, verifyAccessToken, verifyRefreshToken, InvalidTokenError } from "./tokens";
import { Permission } from "./permissions";

const options = {
  accessSecret: "a".repeat(32),
  refreshSecret: "b".repeat(32),
  accessTtlSeconds: 900,
  refreshTtlSeconds: 1_209_600,
};

describe("session token issuance", () => {
  it("issues an access/refresh pair that both verify correctly", () => {
    const { accessToken, refreshToken } = signTokenPair(
      {
        sub: "employee-123",
        actorType: "EMPLOYEE",
        locationId: "location-1",
        permissions: [Permission.RestaurantOrderCreate],
      },
      { sub: "employee-123", actorType: "EMPLOYEE", tokenVersion: 0 },
      options,
    );

    const accessPayload = verifyAccessToken(accessToken, options.accessSecret);
    expect(accessPayload.sub).toBe("employee-123");
    expect(accessPayload.permissions).toContain(Permission.RestaurantOrderCreate);

    const refreshPayload = verifyRefreshToken(refreshToken, options.refreshSecret);
    expect(refreshPayload.sub).toBe("employee-123");
    expect(refreshPayload.tokenVersion).toBe(0);
  });

  it("rejects an access token verified with the wrong secret", () => {
    const { accessToken } = signTokenPair(
      { sub: "employee-123", actorType: "EMPLOYEE", permissions: [] },
      { sub: "employee-123", actorType: "EMPLOYEE", tokenVersion: 0 },
      options,
    );

    expect(() => verifyAccessToken(accessToken, "wrong-secret-wrong-secret-wrong")).toThrow(
      InvalidTokenError,
    );
  });

  it("rejects a refresh token presented as an access token (different secret)", () => {
    const { refreshToken } = signTokenPair(
      { sub: "employee-123", actorType: "EMPLOYEE", permissions: [] },
      { sub: "employee-123", actorType: "EMPLOYEE", tokenVersion: 0 },
      options,
    );

    expect(() => verifyAccessToken(refreshToken, options.accessSecret)).toThrow(InvalidTokenError);
  });

  it("preserves the explicit read-only support marker", () => {
    const { accessToken } = signTokenPair(
      { sub: "platform-user-123", actorType: "EMPLOYEE", locationId: "location-123", permissions: [], supportSession: true },
      { sub: "platform-user-123", actorType: "EMPLOYEE", tokenVersion: 0 },
      options,
    );
    expect(verifyAccessToken(accessToken, options.accessSecret).supportSession).toBe(true);
  });
});
