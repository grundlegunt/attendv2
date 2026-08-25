import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

export interface DatabaseTiming {
  durationMs: number;
  queryCount: number;
}

const databaseTimingStorage = new AsyncLocalStorage<DatabaseTiming>();

export function runWithDatabaseTiming<T>(timing: DatabaseTiming, callback: () => T): T {
  return databaseTimingStorage.run(timing, callback);
}

/**
 * Single shared PrismaClient instance. Nothing in this repo should call
 * `new PrismaClient()` anywhere else — importing this module is the only
 * way the rest of the codebase touches the database, so connection pooling
 * and query logging stay consistent.
 */
declare global {
  // eslint-disable-next-line no-var
  var __cinemaPrisma: PrismaClient<Prisma.PrismaClientOptions, "query"> | undefined;
  // eslint-disable-next-line no-var
  var __cinemaPrismaQueryTimingAttached: boolean | undefined;
}

const prismaLog: Prisma.LogDefinition[] = [
  { emit: "event", level: "query" },
  { emit: "stdout", level: "error" },
  ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout", level: "warn" } as const] : []),
];

export const prisma: PrismaClient<Prisma.PrismaClientOptions, "query"> =
  global.__cinemaPrisma ??
  new PrismaClient({
    log: prismaLog,
  });

if (!global.__cinemaPrismaQueryTimingAttached) {
  prisma.$on("query", (event) => {
    const timing = databaseTimingStorage.getStore();
    if (!timing) return;
    timing.durationMs += event.duration;
    timing.queryCount += 1;
  });
  global.__cinemaPrismaQueryTimingAttached = true;
}

if (process.env.NODE_ENV !== "production") {
  global.__cinemaPrisma = prisma;
}

export * from "@prisma/client";
