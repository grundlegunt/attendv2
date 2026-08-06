/**
 * Seed logic, exported as a function so both the CLI script (bottom of this
 * file) and the integration test suite (apps/api/test) share one source of
 * truth instead of maintaining two copies — see AGENTS.md §8.
 *
 * Never run against a production database — seeded passwords are publicly
 * known test credentials documented in the README, not secrets.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS, Permission, RoleKey, hashPassword, hashPin } from "@cinema/auth";

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
    update: {
      checkDropMinutesBeforeEnd: 30,
      autoSettleGraceMinutes: 5,
      autoSettleTipBasisPoints: 0,
    },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      organizationId: org.id,
      name: "Meridian Cinema",
      address: "Nashville, TN",
      timezone: "America/Chicago",
      currency: "USD",
      cleaningBufferMinutes: 15,
      preShowBufferMinutes: 30,
      checkDropMinutesBeforeEnd: 30,
      autoSettleGraceMinutes: 5,
      autoSettleTipBasisPoints: 0,
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
  const pinHash = await hashPin("1234");

  const owner = await prisma.employee.upsert({
    where: { email: `owner@${suffix}` },
    update: {},
    create: {
      locationId: location.id,
      name: "Olivia Owner",
      email: `owner@${suffix}`,
      authAccount: { create: { passwordHash, pinHash } },
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
      authAccount: { create: { passwordHash, pinHash } },
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
      authAccount: { create: { passwordHash, pinHash } },
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
      authAccount: { create: { passwordHash, pinHash } },
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
  // Nashville is UTC-5 during this summer demo week. Before 05:00 UTC,
  // today's local calendar date is still the preceding UTC date.
  if (firstDate.getTime() > Date.now()) {
    firstDate.setUTCDate(firstDate.getUTCDate() - 1);
  }
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
    update: {
      kitchenStationId: kitchenStation.id,
      priceCents: 1600,
      chargeCategory: "FOOD",
      active: true,
    },
    create: {
      id: "62000000-0000-0000-0000-000000000001",
      menuCategoryId: foodCategory.id,
      kitchenStationId: kitchenStation.id,
      name: "Cheeseburger",
      description: "Double patty, American cheese, pickles, and cinema sauce.",
      priceCents: 1600,
      chargeCategory: "FOOD",
    },
  });
  await prisma.menuItem.upsert({
    where: {
      menuCategoryId_name: {
        menuCategoryId: cocktailsCategory.id,
        name: "Old Fashioned",
      },
    },
    update: {
      kitchenStationId: barStation.id,
      priceCents: 1400,
      chargeCategory: "ALCOHOL",
      active: true,
    },
    create: {
      id: "62000000-0000-0000-0000-000000000002",
      menuCategoryId: cocktailsCategory.id,
      kitchenStationId: barStation.id,
      name: "Old Fashioned",
      description: "Bourbon, bitters, demerara, and orange.",
      priceCents: 1400,
      chargeCategory: "ALCOHOL",
    },
  });

  const publicMenuSections = [
    {
      name: "Shareables", sortOrder: 30, stationId: kitchenStation.id, chargeCategory: "FOOD" as const,
      items: [
        ["Fresh Hot Popcorn", "Traditional salt, dill pickle, cacio e pepe, or sweet kettle.", 700],
        ["Shoestring Fries", "Served with rosemary chive aioli and ketchup.", 800],
        ["Hot Pretzels", "Housemade pretzel rings with white cheddar queso and stone-ground mustard.", 950],
        ["Picnic Platter", "Chef selection of three cheeses and two meats, served with warm baguette, fig jam, nuts, and olives.", 1400],
        ["Stuffed Pepper Dip", "Creamy caramelized onion banana pepper dip with a crispy breadcrumb topping, served with hot bread.", 1100],
        ["Katsu Style Chicken Tenders", "Plain or tossed in tonkatsu, lemon garlic herb, honey mustard, or tangy buffalo sauce. Served with housemade pickles.", 1250],
        ["Corn & Zucchini Fritters", "Light, crispy fritters served with creamy dill dipping sauce.", 1100],
      ],
    },
    {
      name: "Salads", sortOrder: 40, stationId: kitchenStation.id, chargeCategory: "FOOD" as const,
      items: [
        ["Tender Love", "Tangy buffalo chicken tenders on butter lettuce with carrot ribbons and creamy bleu cheese crumbles. Served with buttermilk dill dressing.", 1400],
        ["House Party", "Chopped romaine, carrot, cucumber, red onion, garbanzo beans, toasted sunflower seeds, shredded mozzarella, parmesan, and housemade croutons. Served with garlic shallot vinaigrette.", 1250],
      ],
    },
    {
      name: "Toasties", sortOrder: 50, stationId: kitchenStation.id, chargeCategory: "FOOD" as const,
      items: [
        ["Patty Melt", "Grass-fed organic ground beef, caramelized onions, and white American cheese on Butterlamp sourdough. Add fries for $3.", 1400],
        ["Classic", "Thinly sliced rosemary ham, baby Swiss cheese, and dijonaise on Butterlamp sourdough. Add fries for $3.", 1250],
        ["Short Rib", "Braised short rib, aged white cheddar, and balsamic and caramelized shallot spread on Butterlamp sourdough. Add fries for $3.", 1600],
        ["Broccoli Cheddar", "Charred broccoli and aged white cheddar on Butterlamp sourdough. Add fries for $3.", 1400],
        ["French Onion", "Smashed chicken meatballs, French onion soup-style caramelized onions, melty Gruyere, and mozzarella on Butterlamp sourdough. Add fries for $3.", 1400],
        ["Spanikopita", "Spinach, mozzarella, feta, scallion, dill, and honey sesame crust on Butterlamp sourdough. Add diced lemon garlic herb chicken tenders for $3.", 1250],
      ],
    },
    {
      name: "Sweet Treats", sortOrder: 60, stationId: kitchenStation.id, chargeCategory: "FOOD" as const,
      items: [
        ["Skillet Cookie", "Warm chocolate chip cookie topped with vanilla ice cream.", 950],
        ["Dirt Sundae", "Vanilla soft serve, hot fudge, crumbled OREOs, and gummy worms.", 700],
        ["Seasonal Crumble", "Fruit crumble with buttery graham cracker oat topping.", 1100],
        ["Affogato", "Vanilla soft serve topped with crema espresso.", 800],
        ["Candy Selection", "Gummy worms, peanut M&M's, Reese's Pieces, sour strips, Blow Pops, Milk Duds, and Raisinets.", 300],
      ],
    },
    {
      name: "Cocktails", sortOrder: 70, stationId: barStation.id, chargeCategory: "ALCOHOL" as const,
      items: [
        ["Martini and a ½", "Dirty vodka or clean gin served with a sidecar on ice; Castelvetrano olives, lemon twist, and pickled onion garnish options.", 1400],
        ["Sunrise Cosmo", "Vodka, freshly squeezed lime, pomegranate juice, topped with an Aperol float.", 1400],
        ["Valley Girl", "Gin, freshly squeezed lime, and housemade cucumber melon juice.", 1400],
        ["Dirty Work", "Vodka spiced chai espresso martini.", 1400],
        ["Made in Manhattan", "Rye whiskey, Amaro Nonino, house aromatic bitters, and Luxardo cherry.", 1400],
        ["Old West", "Bourbon or rye, peppercorn simple syrup, house aromatic bitters, and orange peel.", 1400],
        ["Smash Hit", "Bourbon, blackberry, blueberry, mint, and freshly squeezed lemon.", 1400],
        ["Pool Party", "Tequila, hibiscus, jalapeño, freshly squeezed lime, agave, and chili salt rim.", 1400],
        ["Easy Rider", "Mezcal, mango puree, orange liqueur, freshly squeezed lime, and chili salt rim.", 1400],
        ["Ivory Tower", "Gin, elderflower liqueur, dry vermouth, and lemon twist.", 1400],
        ["Highwire Act", "Japanese whiskey, ginger simple syrup, club soda, and freshly squeezed lemon.", 1400],
        ["Scarface", "Rum, cherry cordial, cola, and freshly squeezed lime.", 1400],
        ["Peach Fizz", "Vodka, Pimm's, muddled peach, topped with fizzy orange wine.", 1400],
        ["Ocean Air", "Tequila, freshly squeezed lime and grapefruit, club soda, and saltwater ice cubes.", 1400],
      ],
    },
    {
      name: "Natural Wine", sortOrder: 80, stationId: barStation.id, chargeCategory: "ALCOHOL" as const,
      items: [
        ["Flora Prosecco Brut — Glass", "Sparkling.", 1100], ["Flora Prosecco Brut — Bottle", "Sparkling.", 3200],
        ["Tinc Set Ancestral — Glass", "Sparkling.", 1250], ["Tinc Set Ancestral — Bottle", "Sparkling.", 5400],
        ["Lambrusco Dell’Emilio — Glass", "Sparkling.", 1250], ["Lambrusco Dell’Emilio — Bottle", "Sparkling.", 5400],
        ["Broadbent Vinho Verde — Glass", "White.", 1100], ["Broadbent Vinho Verde — Bottle", "White.", 3200],
        ["Christina Gruner Veltliner — Glass", "White.", 1250], ["Christina Gruner Veltliner — Bottle", "White.", 5400],
        ["Punta Crena Lumassina — Glass", "White.", 1400], ["Punta Crena Lumassina — Bottle", "White.", 5800],
        ["Les Athletes du Vin Chenin Blanc — Glass", "White.", 1400], ["Les Athletes du Vin Chenin Blanc — Bottle", "White.", 5800],
        ["Vin de Days L’Orange — Glass", "Orange and skin contact.", 1250], ["Vin de Days L’Orange — Bottle", "Orange and skin contact.", 5400],
        ["Love You Bunches Rosé — Glass", "Orange and skin contact.", 1250], ["Love You Bunches Rosé — Bottle", "Orange and skin contact.", 5400],
        ["Swick Only Zuul Rosé — Glass", "Orange and skin contact.", 1600], ["Swick Only Zuul Rosé — Bottle", "Orange and skin contact.", 6400],
        ["Gulp Hablo Garnacha — Glass", "Red.", 1100], ["Gulp Hablo Garnacha — Bottle", "Red.", 3200],
        ["Arboreto Montepulciano d’Abruzzo — Glass", "Red.", 1250], ["Arboreto Montepulciano d’Abruzzo — Bottle", "Red.", 5400],
        ["Angelo Negro Vino Rosso — Glass", "Red.", 1400], ["Angelo Negro Vino Rosso — Bottle", "Red.", 5800],
        ["Las Jaras Glou Glou — Glass", "Red.", 1400], ["Las Jaras Glou Glou — Bottle", "Red.", 5800],
      ],
    },
    {
      name: "Beer", sortOrder: 90, stationId: barStation.id, chargeCategory: "ALCOHOL" as const,
      items: [
        ...["Budweiser", "Corona", "Tiny Juicy IPA", "German Pilsner", "Lonestar Lager", "Miller High Life Pony (for 2)"].map((name) => [name, "Bottle or can.", 600] as [string, string, number]),
        ...["Japanese Lager", "Guinness", "Yazoo Pale Ale", "Austin East Cider", "Allagash White", "Bearded Iris Homestyle IPA"].map((name) => [name, "Draft.", 700] as [string, string, number]),
      ],
    },
    {
      name: "Non-Alcoholic", sortOrder: 100, stationId: barStation.id, chargeCategory: "BEVERAGE" as const,
      items: [
        ["Spring in Bottle N/A Sparkling Rosé", null, 1250], ["Best Day Brewing Kölsch", null, 700],
        ["Athletic IPA", null, 700], ["St. Agrestis Phony Negroni", null, 1100],
        ["Ghia Spritz", null, 1100], ["Hi-yo Social Tonic", null, 1250], ["Parch Agave Cocktails", null, 1250],
      ],
    },
    {
      name: "Soda, Coffee & Tea", sortOrder: 110, stationId: barStation.id, chargeCategory: "BEVERAGE" as const,
      items: [
        ...["Coke", "Diet Coke", "Dr. Pepper", "Sprite", "Fresh Squeezed OJ"].map((name) => [name, "Soda and juice.", 500] as [string, string, number]),
        ["Hot Coffee", "Coffee.", 500], ["Cold Brew Coffee", "Coffee.", 600], ["Espresso", "Coffee.", 600],
        ["Latte", "Coffee.", 750], ["Cortado", "Coffee.", 750],
        ...["Spiced Chai", "Jasmine Green", "Lemon Ginger"].map((name) => [name, "Tea.", 500] as [string, string, number]),
      ],
    },
    {
      name: "Movie Specials", sortOrder: 120, stationId: kitchenStation.id, chargeCategory: "FOOD" as const,
      items: [
        ["Grand Prix Burger", "¼ lb. grass-fed beef cheeseburger on a brioche bun with cornichons and truffle aioli.", 1400],
        ["Pitt Crew", "Budweiser tallboy and a shot of whiskey.", 1100],
        ["Redbull Spritz", "Campari, vodka, and Red Bull.", 1100],
        ["Terror Dog", "New York-style Sabrett hot dog topped with sweet onion relish, sauerkraut, and spicy brown mustard.", 1400],
        ["Marshmallow Man", "Toasted brown butter rice krispie treat.", 900],
        ["That’s a Good Meatball", "Grass-fed organic beef meatball sliders topped with marinara and melty mozzarella.", 1400],
        ["Alabama Slammer", "Amaretto, sloe gin, Southern Comfort, and freshly squeezed orange juice.", 1250],
      ],
    },
  ];

  const seededMenuItems = new Map<string, string>();
  for (const section of publicMenuSections) {
    const category = await prisma.menuCategory.upsert({
      where: { locationId_name: { locationId: location.id, name: section.name } },
      update: { active: true, sortOrder: section.sortOrder },
      create: { locationId: location.id, name: section.name, sortOrder: section.sortOrder },
    });
    for (const [sortOrder, item] of section.items.entries()) {
      const [name, description, priceCents] = item;
      const seeded = await prisma.menuItem.upsert({
        where: { menuCategoryId_name: { menuCategoryId: category.id, name } },
        update: { kitchenStationId: section.stationId, description, priceCents, chargeCategory: section.chargeCategory, active: true, is86d: false, sortOrder },
        create: { menuCategoryId: category.id, kitchenStationId: section.stationId, name, description, priceCents, chargeCategory: section.chargeCategory, sortOrder },
      });
      seededMenuItems.set(name, seeded.id);
    }
  }

  const movieSpecials = [
    ["F1", ["Grand Prix Burger", "Pitt Crew", "Redbull Spritz"]],
    ["Ghostbusters", ["Terror Dog", "Marshmallow Man"]],
    ["The Wedding Singer", ["That’s a Good Meatball", "Alabama Slammer"]],
  ] as const;
  for (const [movieTitle, itemNames] of movieSpecials) {
    const movie = movieByTitle.get(movieTitle)!;
    for (const [sortOrder, itemName] of itemNames.entries()) {
      await prisma.moviePairing.upsert({
        where: { movieId_menuItemId: { movieId: movie.id, menuItemId: seededMenuItems.get(itemName)! } },
        update: { sortOrder },
        create: { movieId: movie.id, menuItemId: seededMenuItems.get(itemName)!, sortOrder },
      });
    }
  }
  for (const itemName of ["Pitt Crew", "Redbull Spritz", "Alabama Slammer"]) {
    await prisma.menuItem.update({
      where: { id: seededMenuItems.get(itemName)! },
      data: { kitchenStationId: barStation.id, chargeCategory: "ALCOHOL" },
    });
  }

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
