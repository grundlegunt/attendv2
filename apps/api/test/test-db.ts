import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// embedded-postgres is ESM-only. Constructing the native dynamic import this
// way prevents TypeScript's CommonJS transform from rewriting it to require(),
// which Jest cannot use to load that package.
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{
  default: new (options: {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent: boolean;
  }) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  };
}>;

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

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local port for the test database."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const ciDatabaseUrl = process.env.CI === "true" ? process.env.DATABASE_URL : undefined;
  if (ciDatabaseUrl) {
    const schemaPath = join(__dirname, "../../../packages/database/prisma/schema.prisma");
    const prismaBin = join(__dirname, "../../../packages/database/node_modules/.bin/prisma");
    execFileSync(prismaBin, ["migrate", "deploy", `--schema=${schemaPath}`], {
      env: { ...process.env, DATABASE_URL: ciDatabaseUrl },
      stdio: "pipe",
    });

    return {
      databaseUrl: ciDatabaseUrl,
      stop: async () => undefined,
    };
  }

  const { default: EmbeddedPostgres } = await importEsm("embedded-postgres");
  const dataDir = mkdtempSync(join(tmpdir(), "cinema-test-pg-"));
  const dbName = `cinema_test_${randomUUID().replace(/-/g, "")}`;
  const port = await findAvailablePort();

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(dbName);

    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${dbName}`;

    const schemaPath = join(__dirname, "../../../packages/database/prisma/schema.prisma");
    const prismaBin = join(__dirname, "../../../packages/database/node_modules/.bin/prisma");
    execFileSync(prismaBin, ["migrate", "deploy", `--schema=${schemaPath}`], {
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
  } catch (error) {
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}
