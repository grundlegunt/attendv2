import * as argon2 from "argon2";

/**
 * Password hashing — argon2id, a vetted, standard KDF. Per /docs/SECURITY.md
 * §1: no home-grown cryptography. Never log a raw password or a hash
 * alongside identifying information.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB, OWASP-recommended minimum for argon2id
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainTextPassword: string): Promise<string> {
  if (plainTextPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return argon2.hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainTextPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch {
    // argon2.verify throws on a malformed hash rather than returning false —
    // normalize to a boolean so callers never need a try/catch of their own.
    return false;
  }
}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must contain 4 to 8 digits.");
  return argon2.hash(`staff-pin:${pin}`, ARGON2_OPTIONS);
}

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  if (!/^\d{4,8}$/.test(pin)) return false;
  try { return await argon2.verify(hash, `staff-pin:${pin}`); } catch { return false; }
}
