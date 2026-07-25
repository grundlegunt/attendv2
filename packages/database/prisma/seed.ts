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

function buildPairedSeats(rows: number, seatsPerRow: number) {
  return Array.from({ length: rows }, (_, rowIndex) => {
    const rowLabel = String.fromCharCode(65 + rowIndex);
    return Array.from({ length: seatsPerRow }, (_, seatIndex) => {
      const number = seatIndex + 1;
      const isAccessiblePair = rowIndex === rows - 1 && seatIndex < 2;
      return {
        label: `${rowLabel}${number}`,
        rowLabel,
        number,
        x: seatIndex,
        y: rowIndex,
        type: isAccessiblePair ? (seatIndex === 0 ? "ADA" as const : "COMPANION" as const) : "STANDARD" as const,
        tableGroupId: `${rowLabel}-${Math.floor(seatIndex / 2) + 1}`,
        tablePosition: (seatIndex % 2 === 0 ? "LEFT" : "RIGHT") as const,
      };
    });
  }).flat();
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
      name: "Meridian Cinema Co.",
      legalName: "Meridian Cinema Co. LLC",
      timezone: "America/Chicago",
    },
  });

  const location = await prisma.location.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      organizationId: org.id,
      name: "Meridian Cinema",
      address: "Nashville, TN",
      timezone: "America/Chicago",
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

  log("Seeding Milestone 1 auditoriums and paired seat layouts...");
  const auditoriumConfigs = [
    { id: "10000000-0000-0000-0000-000000000001", name: "Theater 1", rows: 8, seatsPerRow: 12 },
    { id: "10000000-0000-0000-0000-000000000002", name: "Theater 2", rows: 6, seatsPerRow: 10 },
    { id: "10000000-0000-0000-0000-000000000003", name: "Theater 3", rows: 4, seatsPerRow: 8 },
  ];
  for (const config of auditoriumConfigs) {
    const seats = buildPairedSeats(config.rows, config.seatsPerRow);
    await prisma.auditorium.upsert({
      where: { id: config.id },
      update: { name: config.name, capacity: seats.length, active: true },
      create: {
        id: config.id,
        locationId: location.id,
        name: config.name,
        capacity: seats.length,
        seatMap: {
          create: {
            name: `${config.name} paired seating`,
            seats: { create: seats },
          },
        },
      },
    });
  }

  log("Seeding Milestone 1 movies and showtimes...");
  const movies = [
    {
      id: "20000000-0000-0000-0000-000000000001",
      title: "F1",
      runtimeMinutes: 155,
      rating: "PG-13",
      synopsis: "A former driver returns to the grid for one last shot.",
    },
    {
      id: "20000000-0000-0000-0000-000000000002",
      title: "Eddington",
      runtimeMinutes: 148,
      rating: "R",
      synopsis: "A small town standoff spirals into a modern American reckoning.",
    },
    {
      id: "20000000-0000-0000-0000-000000000003",
      title: "Materialists",
      runtimeMinutes: 117,
      rating: "R",
      synopsis: "A New York matchmaker is caught between a perfect match and her past.",
    },
  ];
  for (const movie of movies) {
    await prisma.movie.upsert({
      where: { id: movie.id },
      update: movie,
      create: { ...movie, organizationId: org.id },
    });
  }

  const standardPrice = await prisma.priceTier.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Standard" } },
    update: { ticketPriceMinor: 1700, feeMinor: 200, currency: "USD", appliesOnWeekdays: [] },
    create: {
      organizationId: org.id,
      name: "Standard",
      ticketPriceMinor: 1700,
      feeMinor: 200,
      currency: "USD",
      appliesOnWeekdays: [],
    },
  });
  await prisma.priceTier.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Tuesday" } },
    update: { ticketPriceMinor: 800, feeMinor: 200, currency: "USD", appliesOnWeekdays: [2] },
    create: {
      organizationId: org.id,
      name: "Tuesday",
      ticketPriceMinor: 800,
      feeMinor: 200,
      currency: "USD",
      appliesOnWeekdays: [2],
    },
  });

  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 1);
  base.setUTCHours(16, 0, 0, 0);
  for (let index = 0; index < movies.length; index += 1) {
    const movie = movies[index]!;
    const startsAt = new Date(base.getTime() + index * 45 * 60000);
    const featureStartsAt = new Date(startsAt.getTime() + location.preShowBufferMinutes * 60000);
    const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
    const roomReadyAt = new Date(endsAt.getTime() + location.cleaningBufferMinutes * 60000);
    await prisma.showtime.upsert({
      where: { id: `30000000-0000-0000-0000-00000000000${index + 1}` },
      update: { startsAt, featureStartsAt, endsAt, roomReadyAt, onSale: true },
      create: {
        id: `30000000-0000-0000-0000-00000000000${index + 1}`,
        movieId: movie.id,
        auditoriumId: auditoriumConfigs[index]!.id,
        priceTierId: standardPrice.id,
        startsAt,
        featureStartsAt,
        endsAt,
        roomReadyAt,
        onSale: true,
      },
    });
  }

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
