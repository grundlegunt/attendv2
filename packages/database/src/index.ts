import { PrismaClient } from "@prisma/client";

/**
 * Single shared PrismaClient instance. Nothing in this repo should call
 * `new PrismaClient()` anywhere else — importing this module is the only
 * way the rest of the codebase touches the database, so connection pooling
 * and query logging stay consistent.
 */
declare global {
  // eslint-disable-next-line no-var
  var __cinemaPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__cinemaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__cinemaPrisma = prisma;
}

export * from "@prisma/client";
