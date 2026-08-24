import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@cinema/auth";

dotenv.config({ quiet: true });

const email = process.env.PLATFORM_USER_EMAIL?.trim().toLowerCase();
const name = process.env.PLATFORM_USER_NAME?.trim();
const password = process.env.PLATFORM_USER_PASSWORD;

if (!email || !name || !password) {
  throw new Error("PLATFORM_USER_EMAIL, PLATFORM_USER_NAME, and PLATFORM_USER_PASSWORD are required.");
}
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("PLATFORM_USER_EMAIL must be a valid email address.");
if (password.length < 12) throw new Error("PLATFORM_USER_PASSWORD must contain at least 12 characters.");

const prisma = new PrismaClient();
hashPassword(password)
  .then((passwordHash) => prisma.platformUser.upsert({
    where: { email },
    update: { name, passwordHash, active: true, refreshTokenVersion: { increment: 1 } },
    create: { email, name, passwordHash },
    select: { id: true, email: true, name: true },
  }))
  .then((user) => {
    // Deliberately never print the password or its hash.
    // eslint-disable-next-line no-console
    console.log(`Platform user ready: ${user.name} <${user.email}> (${user.id})`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Platform user creation failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
