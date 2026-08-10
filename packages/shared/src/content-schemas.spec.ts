import { cinemaContentDefaults, cinemaContentSchema } from "./content-schemas";

describe("cinema content", () => {
  it("accepts the complete safe default document", () => {
    expect(cinemaContentSchema.parse(cinemaContentDefaults)).toEqual(cinemaContentDefaults);
  });

  it("rejects unsafe image protocols and unknown layout fields", () => {
    expect(() => cinemaContentSchema.parse({ ...cinemaContentDefaults, afterglow: { ...cinemaContentDefaults.afterglow, imageUrl: "javascript:alert(1)" } })).toThrow();
    expect(() => cinemaContentSchema.parse({ ...cinemaContentDefaults, customHtml: "<script />" })).toThrow();
  });
});
