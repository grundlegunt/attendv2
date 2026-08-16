import { createTicketCheckoutRequestSchema } from "./ticketing-schemas";

const validCheckout = {
  holdTokens: ["fd1d2bea-a043-4d2a-b70b-4e71f76c6bec"],
  holderKey: "checkout-holder-key",
  ticketTypeId: "b9f9ad2f-98c2-4620-a056-8e0c6213448d",
  email: "guest@example.com",
  diningAuthorizationRequested: false,
};

describe("ticket checkout ZIP code", () => {
  it.each(["60601", "60601-1234"])('accepts the US ZIP format "%s"', (zipCode) => {
    expect(
      createTicketCheckoutRequestSchema.parse({ ...validCheckout, zipCode }).zipCode,
    ).toBe(zipCode);
  });

  it("keeps ZIP code optional", () => {
    expect(createTicketCheckoutRequestSchema.parse(validCheckout).zipCode).toBeUndefined();
  });

  it.each(["6060", "606010", "SW1A 1AA", "60601-123"])(
    'rejects the invalid ZIP value "%s"',
    (zipCode) => {
      expect(() =>
        createTicketCheckoutRequestSchema.parse({ ...validCheckout, zipCode }),
      ).toThrow("Enter a valid ZIP code.");
    },
  );
});
