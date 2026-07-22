/**
 * Seed logic, exported as a function so both the CLI script (bottom of this
 * file) and the integration test suite (apps/api/test) share one source of
 * truth instead of maintaining two copies — see AGENTS.md §8.
 *
 * Never run against a production database — seeded passwords are publicly
 * known test credentials documented in the README, not secrets.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS, Permission, RoleKey, hashPassword } from "@cinema/auth";

export const SEED_PASSWORD = "DevPassword123!";

export interface SeedResult {
  organizationId: string;
  locationId: string;
  ownerEmployeeId: string;
  serverEmployeeId: string;
  customerId: string;
}

export async function seedDatabase(
  prisma: PrismaClient,
  options: { silent?: boolean; emailSuffix?: string } = {},
): Promise<SeedResult> {
  const log = options.silent ? () => {} : console.log;
  const suffix = options.emailSuffix ?? "ridgelinecinema.test";

  log("Seeding organization and location...");
  const org = await prisma.organization.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Ridgeline Cinema Co.",
      legalName: "Ridgeline Cinema Co. LLC",
      timezone: "America/New_York",
    },
  });

  const location = await prisma.location.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      organizationId: org.id,
      name: "Ridgeline Dine-In Cinema",
      address: "123 Main St, Ridgeline",
      timezone: "America/New_York",
      currency: "USD",
      cleaningBufferMinutes: 15,
      preShowBufferMinutes: 30,
    },
  });

  log("Seeding permission catalog...");
  for (const key of Object.values(Permission)) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
  }

  log("Seeding roles + role-permission mappings...");
  const roleByKey = new Map<RoleKey, { id: string }>();
  for (const roleKey of Object.values(RoleKey)) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: roleKey } },
      update: {},
      create: {
        organizationId: org.id,
        key: roleKey,
        name: roleKey
          .toLowerCase()
          .split("_")
          .map((w) => w[0]!.toUpperCase() + w.slice(1))
          .join(" "),
      },
    });
    roleByKey.set(roleKey, role);

    for (const permKey of DEFAULT_ROLE_PERMISSIONS[roleKey]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  log("Seeding demo employees (Owner, Server)...");
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const owner = await prisma.employee.upsert({
    where: { email: `owner@${suffix}` },
    update: {},
    create: {
      locationId: location.id,
      name: "Olivia Owner",
      email: `owner@${suffix}`,
      authAccount: { create: { passwordHash } },
    },
  });
  await prisma.employeeRole.upsert({
    where: {
      employeeId_roleId_locationId: {
        employeeId: owner.id,
        roleId: roleByKey.get(RoleKey.Owner)!.id,
        locationId: location.id,
      },
    },
    update: {},
    create: { employeeId: owner.id, roleId: roleByKey.get(RoleKey.Owner)!.id, locationId: location.id },
  });

  const server = await prisma.employee.upsert({
    where: { email: `server@${suffix}` },
    update: {},
    create: {
      locationId: location.id,
      name: "Sam Server",
      email: `server@${suffix}`,
      authAccount: { create: { passwordHash } },
    },
  });
  await prisma.employeeRole.upsert({
    where: {
      employeeId_roleId_locationId: {
        employeeId: server.id,
        roleId: roleByKey.get(RoleKey.Server)!.id,
        locationId: location.id,
      },
    },
    update: {},
    create: { employeeId: server.id, roleId: roleByKey.get(RoleKey.Server)!.id, locationId: location.id },
  });

  log("Seeding a demo customer account...");
  const customer = await prisma.customer.upsert({
    where: { email: `customer@${suffix}` },
    update: {},
    create: {
      email: `customer@${suffix}`,
      name: "Casey Customer",
      isGuest: false,
      authAccount: { create: { passwordHash, emailVerifiedAt: new Date() } },
    },
  });

  return {
    organizationId: org.id,
    locationId: location.id,
    ownerEmployeeId: owner.id,
    serverEmployeeId: server.id,
    customerId: customer.id,
  };
}

// CLI entry point — only runs when this file is executed directly
// (`pnpm db:seed`), not when imported by the test suite.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
  const prisma = new PrismaClient();

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the seed script against NODE_ENV=production.");
  }

  seedDatabase(prisma)
    .then((result) => {
      console.log("\nSeed complete.");
      console.log(`  Owner login:    owner@ridgelinecinema.test / ${SEED_PASSWORD}`);
      console.log(`  Server login:   server@ridgelinecinema.test / ${SEED_PASSWORD}`);
      console.log(`  Customer login: customer@ridgelinecinema.test / ${SEED_PASSWORD}`);
      console.log(`  Location id:    ${result.locationId}`);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
