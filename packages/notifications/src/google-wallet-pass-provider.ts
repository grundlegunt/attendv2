import { createHash } from "node:crypto";

import jwt from "jsonwebtoken";

import type { WalletPassArtifact, WalletPassProvider, WalletTicketPass } from "./wallet-pass-provider";

export interface GoogleWalletPassProviderConfig {
  issuerId: string;
  serviceAccountEmail: string;
  privateKey: string;
  origins?: string[];
}

export type GoogleWalletJwtSigner = (
  claims: Record<string, unknown>,
  privateKey: string,
) => string;

const signJwt: GoogleWalletJwtSigner = (claims, privateKey) =>
  jwt.sign(claims, privateKey.replace(/\\n/g, "\n"), { algorithm: "RS256" });

function translated(value: string) {
  return { defaultValue: { language: "en-US", value } };
}

function stableSuffix(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export class GoogleWalletPassProvider implements WalletPassProvider {
  readonly platform = "google" as const;
  readonly available = true;

  constructor(
    private readonly config: GoogleWalletPassProviderConfig,
    private readonly jwtSigner: GoogleWalletJwtSigner = signJwt,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issueTicketPass(ticket: WalletTicketPass): Promise<WalletPassArtifact> {
    const showingIdentity = [
      ticket.venueName,
      ticket.movieTitle,
      ticket.auditoriumName,
      ticket.startsAt.toISOString(),
    ].join("|");
    const classId = `${this.config.issuerId}.${stableSuffix("show", showingIdentity)}`;
    const objectId = `${this.config.issuerId}.${stableSuffix("ticket", ticket.ticketId)}`;

    const eventTicketClass = {
      id: classId,
      issuerName: ticket.venueName,
      reviewStatus: "UNDER_REVIEW",
      eventName: translated(ticket.movieTitle),
      dateTime: {
        start: ticket.startsAt.toISOString(),
        end: ticket.endsAt.toISOString(),
      },
    };
    const eventTicketObject = {
      id: objectId,
      classId,
      state: "ACTIVE",
      ticketNumber: ticket.orderNumber,
      ticketType: translated(ticket.ticketTypeName),
      seatInfo: {
        seat: translated(ticket.seatLabel),
        section: translated(ticket.auditoriumName),
      },
      barcode: {
        type: "QR_CODE",
        value: ticket.credential,
        alternateText: ticket.orderNumber,
      },
    };
    const claims = {
      iss: this.config.serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(this.now() / 1000),
      origins: this.config.origins ?? [],
      payload: {
        eventTicketClasses: [eventTicketClass],
        eventTicketObjects: [eventTicketObject],
      },
    };
    const token = this.jwtSigner(claims, this.config.privateKey);

    return {
      platform: "google",
      kind: "url",
      saveUrl: `https://pay.google.com/gp/v/save/${token}`,
    };
  }
}
