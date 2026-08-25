import { Buffer } from "node:buffer";

import {
  AppleWalletPassProvider,
  type ApplePassFactory,
} from "./apple-wallet-pass-provider";
import type { WalletTicketPass } from "./wallet-pass-provider";

const ticket: WalletTicketPass = {
  ticketId: "ticket/42",
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

describe("AppleWalletPassProvider", () => {
  it("builds a signed event ticket pass with the admission credential as its QR barcode", async () => {
    const captured: Record<string, unknown> = {};
    const passData = Buffer.from("pkpass");
    const factory: ApplePassFactory = (input) => {
      captured.input = input;
      return {
        type: undefined,
        primaryFields: [],
        secondaryFields: [],
        auxiliaryFields: [],
        headerFields: [],
        backFields: [],
        setBarcodes: (barcode) => { captured.barcode = barcode; },
        getAsBuffer: () => passData,
      };
    };

    const provider = new AppleWalletPassProvider({
      teamIdentifier: "TEAM123",
      passTypeIdentifier: "pass.com.attend.ticket",
      organizationName: "Attend",
      wwdrCertificate: Buffer.from("wwdr"),
      signerCertificate: Buffer.from("cert"),
      signerKey: Buffer.from("key"),
      signerKeyPassphrase: "password",
      icon: Buffer.from("icon"),
      icon2x: Buffer.from("icon2x"),
    }, factory);

    const artifact = await provider.issueTicketPass(ticket);
    const input = captured.input as Parameters<ApplePassFactory>[0];

    expect(provider.available).toBe(true);
    expect(artifact).toEqual({
      platform: "apple",
      kind: "file",
      contentType: "application/vnd.apple.pkpass",
      fileName: "ticket-ticket-42.pkpass",
      data: passData,
    });
    expect(input.properties).toMatchObject({
      serialNumber: ticket.ticketId,
      passTypeIdentifier: "pass.com.attend.ticket",
      teamIdentifier: "TEAM123",
      relevantDate: ticket.startsAt.toISOString(),
      expirationDate: ticket.endsAt.toISOString(),
      groupingIdentifier: ticket.orderNumber,
    });
    expect(Object.keys(input.assets)).toEqual(["icon.png", "icon@2x.png"]);
    expect(captured.barcode).toEqual({
      format: "PKBarcodeFormatQR",
      message: ticket.credential,
      messageEncoding: "iso-8859-1",
      altText: ticket.orderNumber,
    });
  });
});
