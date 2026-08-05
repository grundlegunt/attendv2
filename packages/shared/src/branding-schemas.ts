import { z } from "zod";

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color such as #fe2c54.");
export const brandingAdminThemeSchema = z.enum(["NEUTRAL", "MATCH_CUSTOMER"]);

export const locationBrandingSchema = z.object({
  eyebrow: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(100),
  logoUrl: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), "Logo URL must use HTTP or HTTPS.").nullable(),
  accentColor: hexColorSchema,
  accentMutedColor: hexColorSchema,
  backgroundColor: hexColorSchema,
  elevatedColor: hexColorSchema,
  textPrimaryColor: hexColorSchema,
  textSecondaryColor: hexColorSchema,
  adminTheme: brandingAdminThemeSchema,
});

export const updateLocationBrandingRequestSchema = locationBrandingSchema;
export type LocationBranding = z.infer<typeof locationBrandingSchema>;
export const publicBrandingResponseSchema = z.object({ locationName: z.string(), branding: locationBrandingSchema });
export type PublicBrandingResponse = z.infer<typeof publicBrandingResponseSchema>;
