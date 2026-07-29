import QRCode from "qrcode";
import { EmailProvider, TicketReceipt } from "./email-provider";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class PostmarkEmailProvider implements EmailProvider {
  readonly name = "postmark";

  constructor(
    private readonly serverToken: string,
    private readonly from: string,
  ) {}

  async sendTicketReceipt(receipt: TicketReceipt): Promise<{ messageId: string }> {
    const attachments = await Promise.all(
      receipt.tickets.map(async (ticket, index) => ({
        Name: `ticket-${index + 1}.png`,
        Content: (await QRCode.toDataURL(ticket.credential, { width: 500 })).split(",")[1]!,
        ContentType: "image/png",
        ContentID: `cid:ticket-${ticket.id}`,
      })),
    );
    const ticketHtml = receipt.tickets
      .map(
        (ticket, index) => `
          <section style="margin:24px 0;padding:18px;border:1px solid #ddd;border-radius:8px">
            <h2 style="margin-top:0">${escapeHtml(ticket.movie)}</h2>
            <p>${escapeHtml(ticket.startsAt.toLocaleString("en-US"))}<br>
            ${escapeHtml(ticket.auditorium)} · Seat ${escapeHtml(ticket.seat)}</p>
            <img width="250" height="250" alt="QR ticket for seat ${escapeHtml(ticket.seat)}"
              src="cid:ticket-${ticket.id}">
            <p><small>Ticket ${index + 1} of ${receipt.tickets.length}</small></p>
          </section>`,
      )
      .join("");
    const total = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: receipt.currency,
    }).format(receipt.totalCents / 100);
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: receipt.to,
        Subject: `Your tickets — ${receipt.orderNumber}`,
        HtmlBody: `<p>Hi ${escapeHtml(receipt.guestName?.trim() || "there")},</p>
          <p>Your order <strong>${escapeHtml(receipt.orderNumber)}</strong> is confirmed (${escapeHtml(total)}).</p>
          ${ticketHtml}
          <p>Please show each QR code at the entrance.</p>`,
        TextBody: `Order ${receipt.orderNumber} is confirmed (${total}). Your QR tickets are attached.`,
        MessageStream: "outbound",
        Attachments: attachments,
      }),
    });
    const body = (await response.json()) as {
      MessageID?: string;
      Message?: string;
      ErrorCode?: number;
    };
    if (!response.ok || !body.MessageID) {
      throw new Error(`Postmark rejected the ticket receipt: ${body.Message ?? response.statusText}`);
    }
    return { messageId: body.MessageID };
  }
}
