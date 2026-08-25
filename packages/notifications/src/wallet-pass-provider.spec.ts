import { DisabledWalletPassProvider, TestWalletPassProvider, WalletTicketPass } from "./wallet-pass-provider";

const ticket: WalletTicketPass = { ticketId: "ticket-1", orderNumber: "AT-1001", credential: "test", venueName: "Meridian Cinema", movieTitle: "Tony", auditoriumName: "Theater 1", seatLabel: "F5", ticketTypeName: "Standard", startsAt: new Date("2026-08-25T20:00:00Z"), endsAt: new Date("2026-08-25T22:00:00Z"), timeZone: "America/Chicago" };

describe("wallet pass provider contract", () => {
  it("keeps unconfigured platforms unavailable", async () => {
    const provider = new DisabledWalletPassProvider("apple");
    expect(provider.available).toBe(false);
    await expect(provider.issueTicketPass(ticket)).resolves.toBeNull();
  });

  it("models Apple as a pkpass file and Google as a save URL", async () => {
    await expect(new TestWalletPassProvider("apple").issueTicketPass(ticket)).resolves.toMatchObject({ platform: "apple", kind: "file", contentType: "application/vnd.apple.pkpass" });
    await expect(new TestWalletPassProvider("google").issueTicketPass(ticket)).resolves.toMatchObject({ platform: "google", kind: "url" });
  });
});
