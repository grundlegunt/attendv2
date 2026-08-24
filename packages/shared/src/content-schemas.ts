import { z } from "zod/v3";

const text = (max = 500) => z.string().trim().min(1).max(max);
const paragraph = text(2000);
const imageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
    "Use an HTTP(S) URL or a site-relative path.",
  );
const externalUrl = z.string().trim().url().max(2000).refine(
  (value) => /^https?:\/\//i.test(value),
  "Use an HTTP(S) URL.",
);

export const cinemaContentSchema = z
  .object({
    version: z.literal(1),
    typography: z
      .object({
        headingFont: z.enum(["EDITORIAL", "CLASSIC", "MODERN"]),
        bodyFont: z.enum(["SANS", "HUMANIST", "SERIF"]),
        headingSize: z.enum(["COMPACT", "STANDARD", "LARGE"]).default("STANDARD"),
        bodySize: z.enum(["COMPACT", "STANDARD", "LARGE"]).default("STANDARD"),
      })
      .strict(),
    navigation: z
      .object({
        merchUrl: externalUrl.nullable(),
      })
      .strict()
      .default({ merchUrl: null }),
    showtimes: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        loading: text(180),
        empty: text(180),
        emptyDate: text(180),
      })
      .strict()
      .default({
        eyebrow: "NOW PLAYING",
        title: "Showtimes",
        intro: "Choose a showtime and reserve your seats.",
        loading: "Loading the program…",
        empty: "No showtimes are currently on sale.",
        emptyDate: "No showtimes are scheduled for this date.",
      }),
    comingSoon: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        loading: text(180),
        empty: text(180),
      })
      .strict()
      .default({
        eyebrow: "UPCOMING ENGAGEMENTS",
        title: "Coming Soon",
        intro: "Book ahead for films arriving after today.",
        loading: "Loading upcoming films…",
        empty: "No upcoming engagements are on sale yet.",
      }),
    filmSeries: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        loading: text(180),
        empty: text(180),
      })
      .strict()
      .default({
        eyebrow: "CURATED PROGRAMS",
        title: "Film Series",
        intro:
          "Special programs, repertory runs, and recurring cinema events at {cinema}.",
        loading: "Loading film series…",
        empty: "No film series are on sale yet.",
      }),
    directions: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        locationEyebrow: text(80),
        directionsLabel: text(80),
        addressMissing: text(180),
        loading: text(180),
      })
      .strict()
      .default({
        eyebrow: "PLAN YOUR VISIT",
        title: "Directions",
        intro: "Find the cinema and open turn-by-turn directions.",
        locationEyebrow: "LOCATION",
        directionsLabel: "Open directions",
        addressMissing: "The cinema has not published an address yet.",
        loading: "Loading location details…",
      }),
    account: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        loading: text(180),
        signedInEyebrow: text(80),
        visitEyebrow: text(80),
      })
      .strict()
      .default({
        eyebrow: "YOUR VISIT",
        title: "Account",
        intro: "Your tickets, receipts, and live dining tabs in one place.",
        loading: "Loading your account…",
        signedInEyebrow: "SIGNED IN",
        visitEyebrow: "DURING YOUR VISIT",
      }),
    about: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        experienceEyebrow: text(80),
        experienceTitle: text(180),
        body: z.array(paragraph).min(1).max(4),
        contactEyebrow: text(80),
        directionsLabel: text(80),
      })
      .strict(),
    afterglow: z
      .object({
        imageUrl,
        imageAlt: text(300),
        eyebrow: text(80),
        title: text(120),
        sectionEyebrow: text(80),
        sectionTitle: text(180),
        body: z.array(paragraph).min(1).max(4),
        buttonLabel: text(80),
      })
      .strict(),
    dining: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        howEyebrow: text(80),
        howTitle: text(120),
        steps: z
          .array(z.object({ title: text(120), body: text(500) }).strict())
          .length(3),
        afterglowEyebrow: text(80),
        afterglowTitle: text(120),
        afterglowBody: text(500),
        afterglowButton: text(80),
      })
      .strict(),
    privateEvents: z
      .object({
        eyebrow: text(80),
        title: text(120),
        intro: text(300),
        options: z
          .array(z.object({ title: text(120), body: text(600) }).strict())
          .min(1)
          .max(6),
        closingTitle: text(160),
        closingBody: paragraph,
      })
      .strict(),
  })
  .strict();

export type CinemaContent = z.infer<typeof cinemaContentSchema>;

export const cinemaContentDefaults: CinemaContent = {
  version: 1,
  typography: {
    headingFont: "EDITORIAL",
    bodyFont: "SANS",
    headingSize: "STANDARD",
    bodySize: "STANDARD",
  },
  navigation: {
    merchUrl: null,
  },
  showtimes: {
    eyebrow: "NOW PLAYING",
    title: "Showtimes",
    intro: "Choose a showtime and reserve your seats.",
    loading: "Loading the program…",
    empty: "No showtimes are currently on sale.",
    emptyDate: "No showtimes are scheduled for this date.",
  },
  comingSoon: {
    eyebrow: "UPCOMING ENGAGEMENTS",
    title: "Coming Soon",
    intro: "Book ahead for films arriving after today.",
    loading: "Loading upcoming films…",
    empty: "No upcoming engagements are on sale yet.",
  },
  filmSeries: {
    eyebrow: "CURATED PROGRAMS",
    title: "Film Series",
    intro:
      "Special programs, repertory runs, and recurring cinema events at {cinema}.",
    loading: "Loading film series…",
    empty: "No film series are on sale yet.",
  },
  directions: {
    eyebrow: "PLAN YOUR VISIT",
    title: "Directions",
    intro: "Find the cinema and open turn-by-turn directions.",
    locationEyebrow: "LOCATION",
    directionsLabel: "Open directions",
    addressMissing: "The cinema has not published an address yet.",
    loading: "Loading location details…",
  },
  account: {
    eyebrow: "YOUR VISIT",
    title: "Account",
    intro: "Your tickets, receipts, and live dining tabs in one place.",
    loading: "Loading your account…",
    signedInEyebrow: "SIGNED IN",
    visitEyebrow: "DURING YOUR VISIT",
  },
  about: {
    eyebrow: "OUR CINEMA",
    title: "About",
    intro:
      "Independent cinema, thoughtful programming, and hospitality under one roof.",
    experienceEyebrow: "THE EXPERIENCE",
    experienceTitle: "Movies are better together",
    body: [
      "We bring films to the big screen and give audiences a welcoming place to gather around them. Our cinema pairs reserved seating and distinctive programming with food and drink served for the occasion.",
      "The goal is simple: make every visit feel like a night worth remembering.",
    ],
    contactEyebrow: "CONTACT & VISIT",
    directionsLabel: "Get directions",
  },
  afterglow: {
    imageUrl: "/afterglow-bar.png",
    imageAlt: "Guests gathered at the warmly lit Afterglow bar",
    eyebrow: "BEFORE. AFTER. BETWEEN.",
    title: "Afterglow",
    sectionEyebrow: "BEYOND THE SCREEN",
    sectionTitle: "Keep the night going",
    body: [
      "Afterglow is our place to meet for a drink, talk about the movie, or spend an evening even when you are not seeing a show.",
      "Hours, seating, and service may vary. Check with the cinema team when you arrive.",
    ],
    buttonLabel: "Explore Dining & Bar",
  },
  dining: {
    eyebrow: "DINE AT THE MOVIES",
    title: "Dining & Bar",
    intro: "Food, drinks, and attentive service built around the film.",
    howEyebrow: "YOUR VISIT",
    howTitle: "How it works",
    steps: [
      {
        title: "Order before the show",
        body: "Arrive early, settle in, and place your first order before the lights go down.",
      },
      {
        title: "Service during the film",
        body: "Your server can bring additional food and drinks to your seat during the screening.",
      },
      {
        title: "Pay at the end",
        body: "Review and close your dining tab separately from your movie tickets.",
      },
    ],
    afterglowEyebrow: "STAY A LITTLE LONGER",
    afterglowTitle: "Afterglow",
    afterglowBody:
      "A relaxed place for a drink and conversation before or after the film.",
    afterglowButton: "Learn more",
  },
  privateEvents: {
    eyebrow: "MAKE THE CINEMA YOURS",
    title: "Private Events",
    intro:
      "Host a private screening or bring your group together at the movies.",
    options: [
      {
        title: "Private screenings",
        body: "Reserve an auditorium for invited guests and a film selected with the cinema team.",
      },
      {
        title: "Celebrations",
        body: "Plan birthdays, anniversaries, reunions, and other group occasions in a cinematic setting.",
      },
      {
        title: "Organizations",
        body: "Gather employees, students, members, or community groups for a shared screening.",
      },
    ],
    closingTitle: "Start with the cinema team",
    closingBody:
      "Contact the cinema directly to discuss dates, film availability, capacity, food and beverage, accessibility needs, and pricing. An inquiry does not reserve an auditorium.",
  },
};
