import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password and verifies the correct plaintext against it", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toEqual("correct-horse-battery-staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const ok = await verifyPassword(hash, "correct-horse-battery-staple");
    expect(ok).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    const ok = await verifyPassword(hash, "wrong-password");
    expect(ok).toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const hashA = await hashPassword("same-password-123");
    const hashB = await hashPassword("same-password-123");
    expect(hashA).not.toEqual(hashB);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/at least 8 characters/);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    const ok = await verifyPassword("not-a-real-hash", "anything");
    expect(ok).toBe(false);
  });
});
