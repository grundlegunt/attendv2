import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { InvalidTokenError } from "./tokens";

const MFA_CHALLENGE_ISSUER = "cinema-platform";
const MFA_CHALLENGE_AUDIENCE = "staff-mfa";

export function createMfaSecret(): string {
  return authenticator.generateSecret();
}

export function createMfaUri(secret: string, email: string, issuer: string): string {
  return authenticator.keyuri(email, issuer, secret);
}

export async function verifyMfaCode(secret: string, token: string): Promise<boolean> {
  return authenticator.verify({ secret, token: token.replace(/\s/g, "") });
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(`staff-mfa:${secret}`).digest();
}

export function encryptMfaSecret(secret: string, encryptionSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encryptionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMfaSecret(value: string, encryptionSecret: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted MFA secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encryptionSecret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function signMfaChallenge(employeeId: string, secret: string): string {
  return jwt.sign({ sub: employeeId, purpose: "staff-mfa" }, secret, {
    expiresIn: "5m",
    issuer: MFA_CHALLENGE_ISSUER,
    audience: MFA_CHALLENGE_AUDIENCE,
  });
}

export function verifyMfaChallenge(token: string, secret: string): string {
  try {
    const payload = jwt.verify(token, secret, {
      issuer: MFA_CHALLENGE_ISSUER,
      audience: MFA_CHALLENGE_AUDIENCE,
    }) as jwt.JwtPayload;
    if (payload.purpose !== "staff-mfa" || typeof payload.sub !== "string") throw new Error("wrong token purpose");
    return payload.sub;
  } catch (error) {
    throw new InvalidTokenError(error instanceof Error ? error.message : "unknown");
  }
}
