import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Boots a real, ephemeral PostgreSQL instance for integration tests — not a
 * mock, not SQLite. Per AGENTS.md §7: seat/payment-adjacent correctness
 * must be proven against real Postgres, and starting that habit at
 * Milestone 0 (even for a simple auth flow) keeps later concurrency tests
 * from being the first time this pattern is exercised.
 *
 * CI additionally may run these same tests against a real Postgres service
 * container (see .github/workflows/ci.yml) — this helper is what makes the
 * suite runnable on a laptop with no Docker installed, not a replacement
 * for that.
 */
export interface TestDatabase {
  databaseUrl: string;
  stop: () => Promise<void>;
}

const PORT = 55490;

export async function startTestDatabase(): Promise<TestDatabase> {
  if (process.env.CI && process.env.DATABASE_URL) {
    const schemaPath = join(__dirname, "../../../packages/database/prisma/schema.prisma");
    execSync(`pnpm exec prisma db push --schema="${schemaPath}" --skip-generate --accept-data-loss`, {
      env: process.env,
      stdio: "pipe",
    });
    return { databaseUrl: process.env.DATABASE_URL, stop: async () => {} };
  }

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dataDir = mkdtempSync(join(tmpdir(), "cinema-test-pg-"));
  const dbName = `cinema_test_${randomUUID().replace(/-/g, "")}`;

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(dbName);

  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${PORT}/${dbName}`;

  const schemaPath = join(__dirname, "../../../packages/database/prisma/schema.prisma");
  execSync(`pnpm exec prisma db push --schema="${schemaPath}" --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  return {
    databaseUrl,
    stop: async () => {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
