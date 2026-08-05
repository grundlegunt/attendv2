import { updateLocationBrandingRequestSchema } from "./branding-schemas";

const validBranding = {
  eyebrow: "MERIDIAN",
  displayName: "Cinema",
  logoUrl: null,
  accentColor: "#fe2c54",
  accentMutedColor: "#a91d39",
  backgroundColor: "#0b0b0d",
  elevatedColor: "#16161a",
  textPrimaryColor: "#f5f3ee",
  textSecondaryColor: "#a8a49c",
  adminTheme: "NEUTRAL" as const,
};

describe("location branding", () => {
  it("accepts a complete safe theater theme", () => {
    expect(updateLocationBrandingRequestSchema.parse(validBranding)).toEqual(validBranding);
  });

  it("rejects malformed colors and non-URL logos", () => {
    expect(() => updateLocationBrandingRequestSchema.parse({ ...validBranding, accentColor: "pink" })).toThrow();
    expect(() => updateLocationBrandingRequestSchema.parse({ ...validBranding, logoUrl: "javascript:alert(1)" })).toThrow();
  });
});
