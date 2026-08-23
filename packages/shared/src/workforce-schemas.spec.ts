import { boxOfficeCheckoutRequestSchema } from "./workforce-schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("box-office checkout customer attachment", () => {
  const checkout = {
    requestId: uuid,
    holdTokens: [uuid],
    holderKey: "box-office-holder-key",
    ticketTypeId: uuid,
    cashDrawerId: uuid,
    cashCents: 1,
    cardCents: 0,
    giftCardCents: 0,
  };

  it("accepts an existing customer id without requiring an email", () => {
    expect(boxOfficeCheckoutRequestSchema.parse({ ...checkout, customerId: uuid })).toEqual(expect.objectContaining({ customerId: uuid }));
  });

  it("rejects malformed customer ids", () => {
    expect(() => boxOfficeCheckoutRequestSchema.parse({ ...checkout, customerId: "other-cinema-customer" })).toThrow();
  });
});
