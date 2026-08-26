import { membershipExpiration } from "./membership-checkout.service";

describe("membership renewals", () => {
  it("extends an unexpired membership from its current expiration", () => {
    expect(membershipExpiration(12, new Date("2027-03-15T18:00:00.000Z"), new Date("2026-08-26T12:00:00.000Z"))).toEqual(new Date("2028-03-15T18:00:00.000Z"));
  });

  it("starts a lapsed membership from the renewal date", () => {
    expect(membershipExpiration(3, new Date("2026-01-10T18:00:00.000Z"), new Date("2026-08-26T12:00:00.000Z"))).toEqual(new Date("2026-11-26T12:00:00.000Z"));
  });

  it("clamps month-end expirations instead of rolling into another month", () => {
    expect(membershipExpiration(1, null, new Date("2027-01-31T12:00:00.000Z"))).toEqual(new Date("2027-02-28T12:00:00.000Z"));
  });
});
