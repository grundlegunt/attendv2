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
        tablePosition: seatIndex % 2 === 0 ? ("LEFT" as const) : ("RIGHT" as const),
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

  const kitchenEmployee = await prisma.employee.upsert({
    where: { email: `kitchen@${suffix}` },
    update: {},
    create: {
      locationId: location.id,
      name: "Kai Kitchen",
      email: `kitchen@${suffix}`,
      authAccount: { create: { passwordHash } },
    },
  });
  await prisma.employeeRole.upsert({
    where: {
      employeeId_roleId_locationId: {
        employeeId: kitchenEmployee.id,
        roleId: roleByKey.get(RoleKey.Kitchen)!.id,
        locationId: location.id,
      },
    },
    update: {},
    create: {
      employeeId: kitchenEmployee.id,
      roleId: roleByKey.get(RoleKey.Kitchen)!.id,
      locationId: location.id,
    },
  });

  const bartender = await prisma.employee.upsert({
    where: { email: `bartender@${suffix}` },
    update: {},
    create: {
      locationId: location.id,
      name: "Blair Bartender",
      email: `bartender@${suffix}`,
      authAccount: { create: { passwordHash } },
    },
  });
  await prisma.employeeRole.upsert({
    where: {
      employeeId_roleId_locationId: {
        employeeId: bartender.id,
        roleId: roleByKey.get(RoleKey.Bartender)!.id,
        locationId: location.id,
      },
    },
    update: {},
    create: {
      employeeId: bartender.id,
      roleId: roleByKey.get(RoleKey.Bartender)!.id,
      locationId: location.id,
    },
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
      posterUrl: "/posters/f1.png",
    },
    {
      id: "20000000-0000-0000-0000-000000000002",
      title: "Eddington",
      runtimeMinutes: 148,
      rating: "R",
      synopsis: "A small town standoff spirals into a modern American reckoning.",
      posterUrl: "/posters/eddington.png",
    },
    {
      id: "20000000-0000-0000-0000-000000000003",
      title: "Materialists",
      runtimeMinutes: 117,
      rating: "R",
      synopsis: "A New York matchmaker is caught between a perfect match and her past.",
      posterUrl: "/posters/materialists.png",
    },
    {
      id: "20000000-0000-0000-0000-000000000004",
      title: "Ghostbusters",
      runtimeMinutes: 105,
      rating: "PG",
      synopsis: "Three parapsychologists start a ghost-catching business in New York City.",
      posterUrl: "/posters/ghostbusters.png",
    },
    {
      id: "20000000-0000-0000-0000-000000000005",
      title: "The Wedding Singer",
      runtimeMinutes: 97,
      rating: "PG-13",
      synopsis: "A wedding singer and a waitress fall for each other while engaged to the wrong people.",
      posterUrl: "/posters/the-wedding-singer.png",
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
  const tuesdayPrice = await prisma.priceTier.upsert({
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
  await prisma.ticketType.upsert({
    where: {
      locationId_name: {
        locationId: location.id,
        name: "Standard",
      },
    },
    update: { active: true },
    create: {
      id: "23000000-0000-0000-0000-000000000001",
      locationId: location.id,
      name: "Standard",
      active: true,
    },
  });

  const movieByTitle = new Map(movies.map((movie) => [movie.title, movie]));
  const auditoriumByName = new Map(auditoriumConfigs.map((auditorium) => [auditorium.name, auditorium]));
  const regularDay = [
    { movie: "F1", room: "Theater 3", time: "11:00" },
    { movie: "F1", room: "Theater 1", time: "13:30" },
    { movie: "F1", room: "Theater 1", time: "16:50" },
    { movie: "F1", room: "Theater 1", time: "20:20" },
    { movie: "Materialists", room: "Theater 3", time: "14:25" },
    { movie: "Materialists", room: "Theater 2", time: "17:10" },
    { movie: "Materialists", room: "Theater 2", time: "19:55" },
    { movie: "Materialists", room: "Theater 2", time: "22:50" },
    { movie: "Eddington", room: "Theater 2", time: "13:50" },
    { movie: "Eddington", room: "Theater 3", time: "17:15" },
    { movie: "Eddington", room: "Theater 3", time: "20:35" },
  ];
  const saturday = [
    { movie: "The Wedding Singer", room: "Theater 1", time: "11:00" },
    { movie: "F1", room: "Theater 1", time: "13:30" },
    { movie: "F1", room: "Theater 1", time: "16:50" },
    { movie: "F1", room: "Theater 1", time: "20:20" },
    { movie: "Ghostbusters", room: "Theater 1", time: "23:45" },
    { movie: "Ghostbusters", room: "Theater 2", time: "11:15" },
    { movie: "Eddington", room: "Theater 2", time: "13:50" },
    { movie: "Materialists", room: "Theater 2", time: "17:10" },
    { movie: "Materialists", room: "Theater 2", time: "19:55" },
    { movie: "Materialists", room: "Theater 2", time: "22:50" },
    { movie: "F1", room: "Theater 3", time: "11:00" },
    { movie: "Materialists", room: "Theater 3", time: "14:25" },
    { movie: "Eddington", room: "Theater 3", time: "17:15" },
    { movie: "Eddington", room: "Theater 3", time: "20:35" },
  ];

  // Remove the three simplified Milestone 1 demo showtimes. Weekly program
  // rows are stable and are never deleted here: they can acquire financial
  // history once Milestone 3 checkout is enabled.
  await prisma.showtime.deleteMany({
    where: {
      id: {
        in: [
          "30000000-0000-0000-0000-000000000001",
          "30000000-0000-0000-0000-000000000002",
          "30000000-0000-0000-0000-000000000003",
        ],
      },
    },
  });

  const firstDate = new Date();
  firstDate.setUTCHours(5, 0, 0, 0);
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const date = new Date(firstDate);
    date.setUTCDate(firstDate.getUTCDate() + dayIndex);
    const schedule = date.getUTCDay() === 6 ? saturday : regularDay;

    for (let slotIndex = 0; slotIndex < schedule.length; slotIndex += 1) {
      const slot = schedule[slotIndex]!;
      const movie = movieByTitle.get(slot.movie)!;
      const auditorium = auditoriumByName.get(slot.room)!;
      const [hour, minute] = slot.time.split(":").map(Number);
      const startsAt = new Date(date);
      // Nashville is UTC-5 during this summer demo week.
      startsAt.setUTCHours(hour! + 5, minute!, 0, 0);
      const priceTier = date.getUTCDay() === 2 ? tuesdayPrice : standardPrice;
    const featureStartsAt = new Date(startsAt.getTime() + location.preShowBufferMinutes * 60000);
    const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
    const roomReadyAt = new Date(endsAt.getTime() + location.cleaningBufferMinutes * 60000);
    const showtime = await prisma.showtime.upsert({
        where: { id: `31000000-0000-0000-${String(dayIndex + 1).padStart(4, "0")}-${String(slotIndex + 1).padStart(12, "0")}` },
        update: {
          movieId: movie.id,
          auditoriumId: auditorium.id,
          priceTierId: priceTier.id,
          startsAt,
          featureStartsAt,
          endsAt,
          roomReadyAt,
          onSale: true,
        },
      create: {
          id: `31000000-0000-0000-${String(dayIndex + 1).padStart(4, "0")}-${String(slotIndex + 1).padStart(12, "0")}`,
        movieId: movie.id,
          auditoriumId: auditorium.id,
          priceTierId: priceTier.id,
        startsAt,
        featureStartsAt,
        endsAt,
        roomReadyAt,
        onSale: true,
      },
    });
    const seats = await prisma.seat.findMany({
        where: { seatMap: { auditoriumId: auditorium.id }, active: true },
      select: { id: true },
    });
    await prisma.showtimeSeat.createMany({
      data: seats.map((seat) => ({ showtimeId: showtime.id, seatId: seat.id })),
      skipDuplicates: true,
    });
    }
  }

  log("Seeding Milestone 6 restaurant stations and menu...");
  const kitchenStation = await prisma.kitchenStation.upsert({
    where: { locationId_name: { locationId: location.id, name: "Kitchen" } },
    update: { displayType: "KITCHEN", active: true },
    create: {
      id: "60000000-0000-0000-0000-000000000001",
      locationId: location.id,
      name: "Kitchen",
      displayType: "KITCHEN",
    },
  });
  const barStation = await prisma.kitchenStation.upsert({
    where: { locationId_name: { locationId: location.id, name: "Bar" } },
    update: { displayType: "BAR", active: true },
    create: {
      id: "60000000-0000-0000-0000-000000000002",
      locationId: location.id,
      name: "Bar",
      displayType: "BAR",
    },
  });
  const foodCategory = await prisma.menuCategory.upsert({
    where: { locationId_name: { locationId: location.id, name: "Food" } },
    update: { active: true, sortOrder: 10 },
    create: {
      id: "61000000-0000-0000-0000-000000000001",
      locationId: location.id,
      name: "Food",
      sortOrder: 10,
    },
  });
  const cocktailsCategory = await prisma.menuCategory.upsert({
    where: { locationId_name: { locationId: location.id, name: "Cocktails" } },
    update: { active: true, sortOrder: 20 },
    create: {
      id: "61000000-0000-0000-0000-000000000002",
      locationId: location.id,
      name: "Cocktails",
      sortOrder: 20,
    },
  });
  const burger = await prisma.menuItem.upsert({
    where: {
      menuCategoryId_name: { menuCategoryId: foodCategory.id, name: "Cheeseburger" },
    },
    update: { kitchenStationId: kitchenStation.id, priceCents: 1600, active: true },
    create: {
      id: "62000000-0000-0000-0000-000000000001",
      menuCategoryId: foodCategory.id,
      kitchenStationId: kitchenStation.id,
      name: "Cheeseburger",
      description: "Double patty, American cheese, pickles, and cinema sauce.",
      priceCents: 1600,
    },
  });
  await prisma.menuItem.upsert({
    where: {
      menuCategoryId_name: {
        menuCategoryId: cocktailsCategory.id,
        name: "Old Fashioned",
      },
    },
    update: { kitchenStationId: barStation.id, priceCents: 1400, active: true },
    create: {
      id: "62000000-0000-0000-0000-000000000002",
      menuCategoryId: cocktailsCategory.id,
      kitchenStationId: barStation.id,
      name: "Old Fashioned",
      description: "Bourbon, bitters, demerara, and orange.",
      priceCents: 1400,
    },
  });
  const temperatureGroup = await prisma.modifierGroup.upsert({
    where: {
      menuItemId_name: { menuItemId: burger.id, name: "Temperature" },
    },
    update: {
      selectionType: "SINGLE",
      required: true,
      minSelections: 1,
      maxSelections: 1,
    },
    create: {
      id: "63000000-0000-0000-0000-000000000001",
      menuItemId: burger.id,
      name: "Temperature",
      selectionType: "SINGLE",
      required: true,
      minSelections: 1,
      maxSelections: 1,
    },
  });
  for (const [index, name] of ["Medium", "Well Done"].entries()) {
    await prisma.modifier.upsert({
      where: {
        modifierGroupId_name: { modifierGroupId: temperatureGroup.id, name },
      },
      update: { active: true, sortOrder: index },
      create: {
        modifierGroupId: temperatureGroup.id,
        name,
        priceDeltaCents: 0,
        sortOrder: index,
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
      console.log(`  Kitchen login:  kitchen@ridgelinecinema.test / ${SEED_PASSWORD}`);
      console.log(`  Bartender login: bartender@ridgelinecinema.test / ${SEED_PASSWORD}`);
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
