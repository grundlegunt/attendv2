import { z } from "zod";

export const MovieStatusSchema = z.enum([
  "NOW_PLAYING",
  "COMING_SOON",
  "SPECIAL_EVENT",
  "ARCHIVED",
]);

export type MovieStatus = z.infer<typeof MovieStatusSchema>;

const OptionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const PosterImageUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), "Poster image URL must use HTTP or HTTPS.");

export const CreateMovieSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    rating: OptionalTrimmedString(20),
    runtimeMinutes: z.number().int().min(1).max(1440),
    synopsis: OptionalTrimmedString(5000),
    posterImageUrl: PosterImageUrlSchema.optional().or(z.literal("").transform(() => undefined)),
    status: MovieStatusSchema.default("COMING_SOON"),
  })
  .strict();

export const UpdateMovieSchema = CreateMovieSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "At least one field must be provided.",
);

export const MovieSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  rating: z.string().nullable(),
  runtimeMinutes: z.number().int(),
  synopsis: z.string().nullable(),
  posterImageUrl: z.string().nullable(),
  status: MovieStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateMovieInput = z.infer<typeof CreateMovieSchema>;
export type UpdateMovieInput = z.infer<typeof UpdateMovieSchema>;
export type MovieResponse = z.infer<typeof MovieSchema>;
