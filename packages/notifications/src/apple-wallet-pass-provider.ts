import { Buffer } from "node:buffer";
import { PKPass } from "passkit-generator";

import type { WalletPassArtifact, WalletPassProvider, WalletTicketPass } from "./wallet-pass-provider";

export interface AppleWalletPassProviderConfig {
  teamIdentifier: string;
  passTypeIdentifier: string;
  organizationName: string;
  wwdrCertificate: Uint8Array;
  signerCertificate: Uint8Array;
  signerKey: Uint8Array;
  signerKeyPassphrase?: string;
  icon: Uint8Array;
  icon2x?: Uint8Array;
}

interface ApplePassDocument {
  type: "eventTicket" | undefined;
  readonly primaryFields: ApplePassField[];
  readonly secondaryFields: ApplePassField[];
  readonly auxiliaryFields: ApplePassField[];
  readonly headerFields: ApplePassField[];
  readonly backFields: ApplePassField[];
  setBarcodes(barcode: {
    format: "PKBarcodeFormatQR";
    message: string;
    messageEncoding: string;
    altText: string;
  }): void;
  getAsBuffer(): Buffer;
}

interface ApplePassField {
  key: string;
  value: string | number | Date;
  label?: string;
  dateStyle?: "PKDateStyleMedium";
  timeStyle?: "PKDateStyleShort";
}

interface ApplePassFactoryInput {
  assets: Record<string, Buffer>;
  certificates: {
    wwdr: Buffer;
    signerCert: Buffer;
    signerKey: Buffer;
    signerKeyPassphrase?: string;
  };
  properties: {
    serialNumber: string;
    description: string;
    organizationName: string;
    passTypeIdentifier: string;
    teamIdentifier: string;
    logoText: string;
    backgroundColor: string;
    foregroundColor: string;
    labelColor: string;
    relevantDate: string;
    expirationDate: string;
    groupingIdentifier: string;
  };
}

export type ApplePassFactory = (input: ApplePassFactoryInput) => ApplePassDocument;

const createPass: ApplePassFactory = ({ assets, certificates, properties }) =>
  new PKPass(assets, certificates, properties) as ApplePassDocument;

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "ticket";
}

export class AppleWalletPassProvider implements WalletPassProvider {
  readonly platform = "apple" as const;
  readonly available = true;

  constructor(
    private readonly config: AppleWalletPassProviderConfig,
    private readonly passFactory: ApplePassFactory = createPass,
  ) {}

  async issueTicketPass(ticket: WalletTicketPass): Promise<WalletPassArtifact> {
    const assets: Record<string, Buffer> = {
      "icon.png": Buffer.from(this.config.icon),
    };
    if (this.config.icon2x) assets["icon@2x.png"] = Buffer.from(this.config.icon2x);

    const pass = this.passFactory({
      assets,
      certificates: {
        wwdr: Buffer.from(this.config.wwdrCertificate),
        signerCert: Buffer.from(this.config.signerCertificate),
        signerKey: Buffer.from(this.config.signerKey),
        ...(this.config.signerKeyPassphrase
          ? { signerKeyPassphrase: this.config.signerKeyPassphrase }
          : {}),
      },
      properties: {
        serialNumber: ticket.ticketId,
        description: `${ticket.movieTitle} admission ticket`,
        organizationName: this.config.organizationName,
        passTypeIdentifier: this.config.passTypeIdentifier,
        teamIdentifier: this.config.teamIdentifier,
        logoText: ticket.venueName,
        backgroundColor: "rgb(9, 10, 11)",
        foregroundColor: "rgb(247, 245, 239)",
        labelColor: "rgb(73, 177, 112)",
        relevantDate: ticket.startsAt.toISOString(),
        expirationDate: ticket.endsAt.toISOString(),
        groupingIdentifier: ticket.orderNumber,
      },
    });

    pass.type = "eventTicket";
    pass.headerFields.push({ key: "order", label: "ORDER", value: ticket.orderNumber });
    pass.primaryFields.push({ key: "movie", label: "FILM", value: ticket.movieTitle });
    pass.secondaryFields.push({ key: "venue", label: "CINEMA", value: ticket.venueName });
    pass.auxiliaryFields.push(
      { key: "auditorium", label: "THEATER", value: ticket.auditoriumName },
      { key: "seat", label: "SEAT", value: ticket.seatLabel },
      {
        key: "startsAt",
        label: "SHOWTIME",
        value: ticket.startsAt.toISOString(),
        dateStyle: "PKDateStyleMedium",
        timeStyle: "PKDateStyleShort",
      },
    );
    pass.backFields.push(
      { key: "ticketType", label: "TICKET TYPE", value: ticket.ticketTypeName },
      { key: "timeZone", label: "TIME ZONE", value: ticket.timeZone },
    );
    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: ticket.credential,
      messageEncoding: "iso-8859-1",
      altText: ticket.orderNumber,
    });

    return {
      platform: "apple",
      kind: "file",
      contentType: "application/vnd.apple.pkpass",
      fileName: `ticket-${safeFilePart(ticket.ticketId)}.pkpass`,
      data: pass.getAsBuffer(),
    };
  }
}
