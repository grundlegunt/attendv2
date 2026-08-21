import { authenticator } from "otplib";
import {
  createMfaSecret,
  createMfaUri,
  decryptMfaSecret,
  encryptMfaSecret,
  signMfaChallenge,
  verifyMfaChallenge,
  verifyMfaCode,
} from "./mfa";

const signingSecret = ["test", "signing", "material", "used", "only", "for", "mfa", "tests"].join("-");

describe("staff MFA", () => {
  it("encrypts a TOTP secret at rest and rejects the wrong key", () => {
    const secret = createMfaSecret();
    const encrypted = encryptMfaSecret(secret, signingSecret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted, signingSecret)).toBe(secret);
    expect(() => decryptMfaSecret(encrypted, `${signingSecret}-wrong`)).toThrow();
  });

  it("verifies standards-based authenticator codes", async () => {
    const secret = createMfaSecret();
    const code = authenticator.generate(secret);
    await expect(verifyMfaCode(secret, code)).resolves.toBe(true);
    await expect(verifyMfaCode(secret, "000000")).resolves.toBe(false);
    expect(createMfaUri(secret, "owner@example.com", "Attend Admin")).toContain("otpauth://totp/");
  });

  it("signs a purpose-limited short-lived login challenge", () => {
    const challenge = signMfaChallenge("employee-1", signingSecret);
    expect(verifyMfaChallenge(challenge, signingSecret)).toEqual({ employeeId: "employee-1", challengeId: expect.any(String) });
    expect(() => verifyMfaChallenge(challenge, `${signingSecret}-wrong`)).toThrow();
  });
});
