import { createTicketCheckoutRequestSchema, redeemMobileTicketAccessRequestSchema } from "./ticketing-schemas";

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

describe("ticket checkout admission types", () => {
  it("accepts one ticket type selection per held seat", () => {
    const ticketTypeSelections = [{
      holdToken: validCheckout.holdTokens[0],
      ticketTypeId: validCheckout.ticketTypeId,
    }];
    expect(createTicketCheckoutRequestSchema.parse({ ...validCheckout, ticketTypeSelections }).ticketTypeSelections)
      .toEqual(ticketTypeSelections);
  });
});

describe("ticket checkout SMS consent", () => {
  it("accepts an E.164 phone number with explicit opt-in", () => {
    const parsed = createTicketCheckoutRequestSchema.parse({
      ...validCheckout,
      phone: "+13125551212",
      smsTicketsRequested: true,
    });
    expect(parsed.phone).toBe("+13125551212");
    expect(parsed.smsTicketsRequested).toBe(true);
  });

  it("requires a phone number when SMS tickets are requested", () => {
    expect(() => createTicketCheckoutRequestSchema.parse({
      ...validCheckout,
      smsTicketsRequested: true,
    })).toThrow("A phone number is required");
  });

  it("defaults SMS delivery to not requested", () => {
    expect(createTicketCheckoutRequestSchema.parse(validCheckout).smsTicketsRequested).toBe(false);
  });
});

describe("mobile ticket access", () => {
  it("accepts a 256-bit base64url token", () => {
    const token = "A".repeat(43);
    expect(redeemMobileTicketAccessRequestSchema.parse({ token })).toEqual({ token });
  });

  it.each(["short", `${"A".repeat(42)}!`, "A".repeat(44)])("rejects malformed token %s", (token) => {
    expect(() => redeemMobileTicketAccessRequestSchema.parse({ token })).toThrow("valid mobile ticket token");
  });
});
