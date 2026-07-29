import { createTicketCredential, verifyTicketCredential } from "@cinema/ticketing";

describe("signed ticket credentials", () => {
  const secret = "unit-test-ticket-credential-secret-32-characters";
  const ticketId = "8f75bdd1-e8ec-44a8-8b91-b91f4dd86ee7";

  it("round-trips a signed ticket id", () => {
    const credential = createTicketCredential(ticketId, secret);
    expect(verifyTicketCredential(credential, secret)).toEqual({ ticketId });
    expect(credential).not.toContain(ticketId);
  });

  it("rejects tampering and the wrong signing secret", () => {
    const credential = createTicketCredential(ticketId, secret);
    expect(verifyTicketCredential(`${credential}x`, secret)).toBeNull();
    expect(
      verifyTicketCredential(credential, "different-unit-test-secret-at-least-32-characters"),
    ).toBeNull();
  });
});
