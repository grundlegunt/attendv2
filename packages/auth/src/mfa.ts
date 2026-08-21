import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
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

function bytes(value: ArrayLike<number>): Uint8Array {
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    copy[index] = value[index] ?? 0;
  }
  return copy;
}

function decodeBase64Url(value: string): Uint8Array {
  return bytes(Buffer.from(value, "base64url"));
}

function encryptionKey(secret: string): Uint8Array {
  return bytes(createHash("sha256").update(`staff-mfa:${secret}`).digest());
}

export function encryptMfaSecret(secret: string, encryptionSecret: string): string {
  const iv = bytes(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encryptionSecret), iv);
  const ciphertext = Buffer.concat([bytes(cipher.update(secret, "utf8")), bytes(cipher.final())]);
  return [
    "v1",
    Buffer.from(iv).toString("base64url"),
    Buffer.from(bytes(cipher.getAuthTag())).toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptMfaSecret(value: string, encryptionSecret: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted MFA secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encryptionSecret), decodeBase64Url(iv));
  decipher.setAuthTag(decodeBase64Url(tag));
  return Buffer.concat([
    bytes(decipher.update(decodeBase64Url(ciphertext))),
    bytes(decipher.final()),
  ]).toString("utf8");
}

export function signMfaChallenge(employeeId: string, secret: string): string {
  return jwt.sign({ sub: employeeId, purpose: "staff-mfa" }, secret, {
    expiresIn: "5m",
    issuer: MFA_CHALLENGE_ISSUER,
    audience: MFA_CHALLENGE_AUDIENCE,
    jwtid: randomUUID(),
  });
}

export function verifyMfaChallenge(token: string, secret: string): { employeeId: string; challengeId: string } {
  try {
    const payload = jwt.verify(token, secret, {
      issuer: MFA_CHALLENGE_ISSUER,
      audience: MFA_CHALLENGE_AUDIENCE,
    }) as jwt.JwtPayload;
    if (payload.purpose !== "staff-mfa" || typeof payload.sub !== "string" || typeof payload.jti !== "string") throw new Error("wrong token purpose");
    return { employeeId: payload.sub, challengeId: payload.jti };
  } catch (error) {
    throw new InvalidTokenError(error instanceof Error ? error.message : "unknown");
  }
}
