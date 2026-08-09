import { z } from "zod";

export const customerBrandingDefaults = {
  accentColor: "#fe2c54",
  accentMutedColor: "#a91d39",
  backgroundColor: "#0b0b0d",
  backgroundGlowColor: "#3a0f1b",
  surfaceColor: "#16161a",
  textColor: "#f5f3ee",
  mutedTextColor: "#a8a49c",
} as const;

export const adminBrandingDefaults = {
  accentColor: "#ffb800",
  accentMutedColor: "#8a6500",
  backgroundColor: "#000000",
  surfaceColor: "#1a1a1a",
  textColor: "#ffffff",
  mutedTextColor: "#cccccc",
} as const;

export const adminUiDefaults = {
  fontFamily: "SYSTEM",
  onSaleColor: "#2f7653",
  draftColor: "#665022",
  pastColor: "#3a3d38",
  labels: {
    scheduleTitle: "Daily theater schedule",
    scheduleInstructions: "Click an open time to add a showing. Click a film to edit it.",
    day: "Day", week: "Week", export: "Export Excel", duplicateDay: "Duplicate day", today: "Today",
    onSale: "On sale", draft: "Draft", past: "Past", room: "Room",
    filmLibrary: "Film library", filmLibraryHelp: "Search, review, or quickly add a film to the schedule.",
    addMovie: "Add movie +", search: "Search",
  },
} as const;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color such as #fe2c54.");
const customerLogoUrlSchema = z.union([
  z.string().trim().url("Logo URL must be a valid URL."),
  z.string().trim().regex(/^\/(?!\/)/, "Logo path must begin with a single slash."),
]);

export const customerBrandingSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  logoUrl: customerLogoUrlSchema.nullable().optional(),
  accentColor: hexColorSchema.nullable().optional(),
  accentMutedColor: hexColorSchema.nullable().optional(),
  backgroundColor: hexColorSchema.nullable().optional(),
  backgroundGlowColor: hexColorSchema.nullable().optional(),
  surfaceColor: hexColorSchema.nullable().optional(),
  textColor: hexColorSchema.nullable().optional(),
  mutedTextColor: hexColorSchema.nullable().optional(),
}).strict();

export type CustomerBranding = z.infer<typeof customerBrandingSchema>;

export const adminBrandingSchema = z.object({
  adminAccentColor: hexColorSchema.nullable().optional(),
  adminAccentMutedColor: hexColorSchema.nullable().optional(),
  adminBackgroundColor: hexColorSchema.nullable().optional(),
  adminSurfaceColor: hexColorSchema.nullable().optional(),
  adminTextColor: hexColorSchema.nullable().optional(),
  adminMutedTextColor: hexColorSchema.nullable().optional(),
}).strict();

export type AdminBranding = z.infer<typeof adminBrandingSchema>;

const adminUiLabelSchema = z.string().trim().min(1).max(120);
export const adminUiConfigSchema = z.object({
  fontFamily: z.enum(["SYSTEM", "SERIF", "MODERN", "MONO"]),
  onSaleColor: hexColorSchema,
  draftColor: hexColorSchema,
  pastColor: hexColorSchema,
  labels: z.object({
    scheduleTitle: adminUiLabelSchema,
    scheduleInstructions: z.string().trim().min(1).max(240),
    day: adminUiLabelSchema, week: adminUiLabelSchema, export: adminUiLabelSchema,
    duplicateDay: adminUiLabelSchema, today: adminUiLabelSchema,
    onSale: adminUiLabelSchema, draft: adminUiLabelSchema, past: adminUiLabelSchema, room: adminUiLabelSchema,
    filmLibrary: adminUiLabelSchema, filmLibraryHelp: z.string().trim().min(1).max(240),
    addMovie: adminUiLabelSchema, search: adminUiLabelSchema,
  }).strict(),
}).strict();
export type AdminUiConfig = z.infer<typeof adminUiConfigSchema>;

export const seatTypeSchema = z.enum(["STANDARD", "ADA", "COMPANION"]);
export const tablePositionSchema = z.enum(["LEFT", "RIGHT"]);

export const seatInputSchema = z.object({
  label: z.string().trim().min(1).max(12),
  rowLabel: z.string().trim().min(1).max(8),
  number: z.number().int().positive(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  type: seatTypeSchema.default("STANDARD"),
  tableGroupId: z.string().trim().min(1).max(40).nullable().optional(),
  tablePosition: tablePositionSchema.nullable().optional(),
  levelKey: z.string().trim().min(1).max(40).nullable().optional(),
  sectionKey: z.string().trim().min(1).max(40).nullable().optional(),
});

export type SeatInput = z.infer<typeof seatInputSchema>;

export const layoutElementTypeSchema = z.enum([
  "AISLE", "STAIRWAY", "WALL", "DOOR", "EXIT", "EMERGENCY_EXIT",
  "SERVICE_DOOR", "WHEELCHAIR_SPACE", "TABLE", "LABEL",
  "NOT_A_SEAT", "ACCESSIBLE_PLATFORM",
]);

export const seatMapLayoutSchema = z.object({
  mode: z.enum(["BASIC", "ADVANCED"]),
  canvas: z.object({ width: z.number().int().min(12).max(200), height: z.number().int().min(8).max(200) }),
  screenPosition: z.enum(["TOP", "BOTTOM", "LEFT", "RIGHT"]).default("TOP"),
  seatingStyle: z.enum(["SINGLE", "PAIR", "LOVESEAT", "TABLE_2", "TABLE_4", "BENCH"]).default("SINGLE"),
  levels: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(80),
    sortOrder: z.number().int().nonnegative(),
    elevationLabel: z.string().trim().max(80).nullable().optional(),
  })).min(1).max(12),
  sections: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    levelId: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(80),
  })).max(40).default([]),
  elements: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    type: layoutElementTypeSchema,
    levelId: z.string().trim().min(1).max(40),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive().max(100),
    height: z.number().int().positive().max(100),
    label: z.string().trim().max(100).nullable().optional(),
    orientation: z.enum(["HORIZONTAL", "VERTICAL"]).nullable().optional(),
  })).max(500).default([]),
});

export type SeatMapLayout = z.infer<typeof seatMapLayoutSchema>;

export const createAuditoriumRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  seatMapName: z.string().trim().min(1).max(80),
  seats: z.array(seatInputSchema).min(1).max(500),
  layout: seatMapLayoutSchema.optional(),
});

export const updateAuditoriumLayoutRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  seatMapName: z.string().trim().min(1).max(80).optional(),
  seats: z.array(seatInputSchema).min(1).max(500),
  layout: seatMapLayoutSchema,
});

export const duplicateAuditoriumRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const createMovieRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().trim().max(2000).nullable().optional(),
  runtimeMinutes: z.number().int().min(1).max(600),
  rating: z.string().trim().max(20).nullable().optional(),
  posterUrl: z.union([
    z.string().trim().url("Poster URL must be a valid URL."),
    z.string().trim().regex(/^\/(?!\/)/, "Poster path must begin with a single slash."),
  ]).nullable().optional(),
  director: z.string().trim().max(200).nullable().optional(),
  starring: z.string().trim().max(1000).nullable().optional(),
  trailerUrl: z.string().trim().url("Trailer URL must be a valid URL.").nullable().optional(),
  releaseYear: z.number().int().min(1888).max(2200).nullable().optional(),
  pairingMenuItemIds: z.array(z.string().uuid()).max(20).default([]),
});

const artworkUrlSchema = z.union([
  z.string().trim().url("Artwork URL must be a valid URL."),
  z.string().trim().regex(/^\/(?!\/)/, "Artwork path must begin with a single slash."),
]);

export const createFilmSeriesRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  artworkUrl: artworkUrlSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const updateFilmSeriesRequestSchema = createFilmSeriesRequestSchema.partial().extend({
  active: z.boolean().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one film-series field is required.",
);

export const showtimePresentationSchema = z.enum(["STANDARD", "OPEN_CAPTIONS", "Q_AND_A", "SPECIAL_GUEST"]);

const showtimeFieldsSchema = z.object({
  movieId: z.string().uuid(),
  auditoriumId: z.string().uuid(),
  priceTierId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }),
  onSale: z.boolean(),
  filmSeriesId: z.string().uuid().nullable().optional(),
  presentation: showtimePresentationSchema,
  format: z.string().trim().max(80).nullable().optional(),
});

export const createShowtimeRequestSchema = showtimeFieldsSchema.extend({
  onSale: z.boolean().default(true),
  presentation: showtimePresentationSchema.default("STANDARD"),
});

export const duplicateShowtimeDayRequestSchema = z.object({
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
  saleStatus: z.enum(["PRESERVE", "DRAFT", "ON_SALE"]).default("PRESERVE"),
}).superRefine((value, context) => {
  if (new Set(value.targetDates).size !== value.targetDates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetDates"], message: "Target dates must be unique." });
  }
  if (value.targetDates.includes(value.sourceDate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetDates"], message: "The source day cannot also be a target day." });
  }
});

export const updateMovieRequestSchema = createMovieRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one movie field is required.",
);

export const updateShowtimeRequestSchema = showtimeFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one showtime field is required.",
);

export function validateSeatLayout(seats: SeatInput[]): string[] {
  const errors: string[] = [];
  const labels = new Set<string>();
  const coordinates = new Set<string>();
  const tables = new Map<string, SeatInput[]>();

  for (const seat of seats) {
    const normalizedLabel = seat.label.toUpperCase();
    if (labels.has(normalizedLabel)) errors.push(`Duplicate seat label: ${seat.label}.`);
    labels.add(normalizedLabel);

    const coordinate = `${seat.levelKey ?? "main"}:${seat.x}:${seat.y}`;
    if (coordinates.has(coordinate)) errors.push(`Duplicate seat coordinate: ${seat.x}:${seat.y}.`);
    coordinates.add(coordinate);

    if (Boolean(seat.tableGroupId) !== Boolean(seat.tablePosition)) {
      errors.push(`Seat ${seat.label} must specify both tableGroupId and tablePosition.`);
    }
    if (seat.tableGroupId) {
      const group = tables.get(seat.tableGroupId) ?? [];
      group.push(seat);
      tables.set(seat.tableGroupId, group);
    }
  }

  for (const [groupId, group] of tables) {
    const positions = new Set(group.map((seat) => seat.tablePosition));
    if (group.length !== 2 || !positions.has("LEFT") || !positions.has("RIGHT")) {
      errors.push(`Table group ${groupId} must contain exactly one LEFT and one RIGHT seat.`);
    }
  }
  return errors;
}

export function validateAdvancedSeatLayout(seats: SeatInput[], layout: SeatMapLayout): string[] {
  const errors = validateSeatLayout(seats);
  const levelIds = new Set(layout.levels.map((level) => level.id));
  const sectionIds = new Set(layout.sections.map((section) => section.id));
  for (const section of layout.sections) {
    if (!levelIds.has(section.levelId)) errors.push(`Section ${section.name} references a missing level.`);
  }
  for (const seat of seats) {
    if (seat.levelKey && !levelIds.has(seat.levelKey)) errors.push(`Seat ${seat.label} is outside a defined level.`);
    if (seat.sectionKey && !sectionIds.has(seat.sectionKey)) errors.push(`Seat ${seat.label} references a missing section.`);
    if (seat.x >= layout.canvas.width || seat.y >= layout.canvas.height) errors.push(`Seat ${seat.label} is outside the canvas.`);
    if (seat.x >= layout.canvas.width || seat.y >= layout.canvas.height) {
      errors.push(`Seat ${seat.label} is outside the canvas.`);
    }
  }
  for (const element of layout.elements) {
    if (!levelIds.has(element.levelId)) errors.push(`Layout element ${element.label ?? element.id} references a missing level.`);
    if (element.x + element.width > layout.canvas.width || element.y + element.height > layout.canvas.height) {
      errors.push(`Layout element ${element.label ?? element.id} is outside the canvas.`);
    }
  }
  return errors;
}

export interface ShowtimeWindow {
  startsAt: Date;
  roomReadyAt: Date;
}

export function showtimeWindowsOverlap(a: ShowtimeWindow, b: ShowtimeWindow): boolean {
  return a.startsAt < b.roomReadyAt && b.startsAt < a.roomReadyAt;
}

export interface PublicShowtime {
  id: string;
  startsAt: string;
  auditorium: { id: string; name: string; capacity: number };
  priceTier: { name: string; ticketPriceMinor: number; feeMinor: number; currency: string };
  filmSeries: { id: string; name: string } | null;
  format: string | null;
}

/**
 * Keep one public screening when legacy/demo data contains multiple rows for
 * the same auditorium and advertised start time. A database cleanup can then
 * happen independently without showing duplicate purchase choices.
 */
export function dedupePublicShowtimes(showtimes: PublicShowtime[]): PublicShowtime[] {
  const unique = new Map<string, PublicShowtime>();
  for (const showtime of showtimes) {
    const key = `${showtime.auditorium.id}:${showtime.startsAt}`;
    if (!unique.has(key)) unique.set(key, showtime);
  }
  return [...unique.values()];
}

/** Return the UTC instant at which the supplied calendar day began locally. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const localMidnightAsUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!);

  // Resolve the zone offset at the target instant twice so this remains
  // correct across daylight-saving transitions as well as ordinary days.
  let candidate = localMidnightAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateParts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      candidateParts.year!,
      candidateParts.month! - 1,
      candidateParts.day!,
      candidateParts.hour!,
      candidateParts.minute!,
      candidateParts.second!,
    );
    candidate = localMidnightAsUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate);
}

export interface NowPlayingMovie {
  id: string;
  title: string;
  synopsis: string | null;
  runtimeMinutes: number;
  rating: string | null;
  posterUrl: string | null;
  director: string | null;
  starring: string | null;
  trailerUrl: string | null;
  releaseYear: number | null;
  showtimes: PublicShowtime[];
}

export interface PublicMoviePairing {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
}

export interface PublicMovieDetail extends NowPlayingMovie {
  pairings: PublicMoviePairing[];
}

export type ShowtimePresentation = z.infer<typeof showtimePresentationSchema>;

export interface PublicFilmSeriesShowtime extends PublicShowtime {
  presentation: ShowtimePresentation;
}

export interface PublicFilmSeriesMovie extends Omit<NowPlayingMovie, "showtimes"> {
  showtimes: PublicFilmSeriesShowtime[];
}

export interface PublicFilmSeries {
  id: string;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  movies: PublicFilmSeriesMovie[];
}
