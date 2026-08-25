export type WalletPlatform = "apple" | "google";

export interface WalletTicketPass {
  ticketId: string;
  orderNumber: string;
  credential: string;
  venueName: string;
  movieTitle: string;
  auditoriumName: string;
  seatLabel: string;
  ticketTypeName: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

export type WalletPassArtifact =
  | { platform: "apple"; kind: "file"; contentType: "application/vnd.apple.pkpass"; fileName: string; data: Uint8Array }
  | { platform: "google"; kind: "url"; saveUrl: string };

export interface WalletPassProvider {
  readonly platform: WalletPlatform;
  readonly available: boolean;
  issueTicketPass(ticket: WalletTicketPass): Promise<WalletPassArtifact | null>;
}

export class DisabledWalletPassProvider implements WalletPassProvider {
  readonly available = false;
  constructor(readonly platform: WalletPlatform) {}
  async issueTicketPass(_ticket: WalletTicketPass) { return null; }
}

export class TestWalletPassProvider implements WalletPassProvider {
  readonly available = true;
  readonly issued: WalletTicketPass[] = [];
  constructor(readonly platform: WalletPlatform) {}

  async issueTicketPass(ticket: WalletTicketPass): Promise<WalletPassArtifact> {
    this.issued.push(ticket);
    return this.platform === "apple"
      ? { platform: "apple", kind: "file", contentType: "application/vnd.apple.pkpass", fileName: `ticket-${ticket.ticketId}.pkpass`, data: Buffer.from(ticket.credential) }
      : { platform: "google", kind: "url", saveUrl: `https://pay.google.com/gp/v/save/test-${encodeURIComponent(ticket.ticketId)}` };
  }
}
