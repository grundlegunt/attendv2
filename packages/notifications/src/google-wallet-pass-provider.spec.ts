import {
  GoogleWalletPassProvider,
  type GoogleWalletJwtSigner,
} from "./google-wallet-pass-provider";
import type { WalletTicketPass } from "./wallet-pass-provider";

const ticket: WalletTicketPass = {
  ticketId: "ticket-42",
  orderNumber: "ATT-1042",
  credential: "test",
  venueName: "Meridian Cinema",
  movieTitle: "Tony",
  auditoriumName: "Theater 1",
  seatLabel: "F7",
  ticketTypeName: "Standard",
  startsAt: new Date("2026-08-24T20:10:00.000Z"),
  endsAt: new Date("2026-08-24T22:15:00.000Z"),
  timeZone: "America/Chicago",
};

describe("GoogleWalletPassProvider", () => {
  it("creates a stable signed save URL containing an event class and ticket object", async () => {
    const captured: { claims?: Record<string, unknown>; privateKey?: string } = {};
    const signer: GoogleWalletJwtSigner = (claims, privateKey) => {
      captured.claims = claims;
      captured.privateKey = privateKey;
      return "signed-jwt";
    };
    const provider = new GoogleWalletPassProvider({
      issuerId: "3388000000022290000",
      serviceAccountEmail: "wallet@example.invalid",
      privateKey: "test",
      origins: ["https://tickets.example.invalid"],
    }, signer, () => 1_787_600_000_000);

    await expect(provider.issueTicketPass(ticket)).resolves.toEqual({
      platform: "google",
      kind: "url",
      saveUrl: "https://pay.google.com/gp/v/save/signed-jwt",
    });

    expect(captured.privateKey).toBe("test");
    expect(captured.claims).toMatchObject({
      iss: "wallet@example.invalid",
      aud: "google",
      typ: "savetowallet",
      iat: 1_787_600_000,
      origins: ["https://tickets.example.invalid"],
    });
    const payload = captured.claims?.payload as {
      eventTicketClasses: Array<Record<string, unknown>>;
      eventTicketObjects: Array<Record<string, unknown>>;
    };
    expect(payload.eventTicketClasses[0]).toMatchObject({
      issuerName: ticket.venueName,
      eventName: translated(ticket.movieTitle),
      dateTime: { start: ticket.startsAt.toISOString(), end: ticket.endsAt.toISOString() },
    });
    expect(payload.eventTicketObjects[0]).toMatchObject({
      state: "ACTIVE",
      ticketNumber: ticket.orderNumber,
      ticketType: translated(ticket.ticketTypeName),
      seatInfo: {
        seat: translated(ticket.seatLabel),
        section: translated(ticket.auditoriumName),
      },
      barcode: { type: "QR_CODE", value: ticket.credential, alternateText: ticket.orderNumber },
    });
    expect(payload.eventTicketObjects[0]?.classId).toBe(payload.eventTicketClasses[0]?.id);
  });

  it("signs a compact RS256 token with a service-account private key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const provider = new GoogleWalletPassProvider({
      issuerId: "3388000000022290000",
      serviceAccountEmail: "wallet@example.invalid",
      privateKey: privateKey.replace(/\n/g, "\\n"),
    });

    const artifact = await provider.issueTicketPass({
      ...ticket,
      credential: `at1.${"a".repeat(48)}.${"b".repeat(43)}`,
    });

    expect(artifact.kind).toBe("url");
    if (artifact.kind !== "url") throw new Error("Expected Google Wallet save URL");
    const token = artifact.saveUrl.replace("https://pay.google.com/gp/v/save/", "");
    expect(jwt.verify(token, publicKey, { algorithms: ["RS256"] })).toMatchObject({
      iss: "wallet@example.invalid",
      aud: "google",
      typ: "savetowallet",
    });
    expect(token.length).toBeLessThan(1_800);
  });
});

function translated(value: string) {
  return { defaultValue: { language: "en-US", value } };
}
import { generateKeyPairSync } from "node:crypto";

import jwt from "jsonwebtoken";
