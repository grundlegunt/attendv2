import QRCode from "qrcode";
import {
  EmailProvider,
  GiftCardDelivery,
  RestaurantPaymentFailedNotice,
  RestaurantReceiptDelivery,
  TicketReceipt,
  CustomerPasswordResetDelivery,
} from "./email-provider";

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
    const money = (cents: number) => new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: receipt.currency,
    }).format(cents / 100);
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
    const total = money(receipt.totalCents);
    const orderAheadHtml = receipt.orderAhead
      ? `<section style="margin:24px 0;padding:18px;border:1px solid #ddd;border-radius:8px">
          <h2 style="margin-top:0">Order ahead</h2>
          <ul>${receipt.orderAhead.items
            .map((item) => `<li>${item.quantity}× ${escapeHtml(item.name)} — ${escapeHtml(money(item.totalCents))}</li>`)
            .join("")}</ul>
          <p>Subtotal: ${escapeHtml(money(receipt.orderAhead.subtotalCents))}<br>
          Tax: ${escapeHtml(money(receipt.orderAhead.taxCents))}<br>
          Service charge: ${escapeHtml(money(receipt.orderAhead.serviceChargeCents))}</p>
        </section>`
      : "";
    const orderAheadText = receipt.orderAhead
      ? `\n\nOrder ahead\n${receipt.orderAhead.items
          .map((item) => `${item.quantity}x ${item.name} — ${money(item.totalCents)}`)
          .join("\n")}\nSubtotal: ${money(receipt.orderAhead.subtotalCents)}\nTax: ${money(receipt.orderAhead.taxCents)}\nService charge: ${money(receipt.orderAhead.serviceChargeCents)}`
      : "";
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
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
          ${orderAheadHtml}
          <p>Please show each QR code at the entrance.</p>`,
        TextBody: `Order ${receipt.orderNumber} is confirmed (${total}). Your QR tickets are attached.${orderAheadText}`,
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

  async sendCustomerPasswordReset(
    delivery: CustomerPasswordResetDelivery,
  ): Promise<{ messageId: string }> {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: delivery.to,
        Subject: "Reset your cinema account password",
        HtmlBody: `<p>Hi ${escapeHtml(delivery.customerName?.trim() || "there")},</p><p>Use the link below within ${delivery.expiresInMinutes} minutes to choose a new password.</p><p><a href="${escapeHtml(delivery.resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
        TextBody: `Reset your password within ${delivery.expiresInMinutes} minutes: ${delivery.resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        MessageStream: "outbound",
      }),
    });
    const body = (await response.json()) as { MessageID?: string; Message?: string };
    if (!response.ok || !body.MessageID) {
      throw new Error(`Postmark rejected the password reset email: ${body.Message ?? response.statusText}`);
    }
    return { messageId: body.MessageID };
  }

  async sendGiftCardDelivery(delivery: GiftCardDelivery): Promise<{ messageId: string }> {
    const total = new Intl.NumberFormat("en-US", { style: "currency", currency: delivery.currency }).format(delivery.amountCents / 100);
    const response = await fetch("https://api.postmarkapp.com/email", { method: "POST", signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": this.serverToken }, body: JSON.stringify({ From: this.from, To: delivery.to, Subject: `Your ${delivery.theaterName} gift card`, HtmlBody: `<p>Hi ${escapeHtml(delivery.recipientName?.trim() || "there")},</p><p>${escapeHtml(delivery.buyerEmail)} sent you a ${escapeHtml(total)} gift card for ${escapeHtml(delivery.theaterName)}.</p>${delivery.message ? `<blockquote>${escapeHtml(delivery.message)}</blockquote>` : ""}<p>Your gift card code is:</p><p style="font-size:20px;font-weight:bold;letter-spacing:1px">${escapeHtml(delivery.code)}</p><p>Keep this email and enter the code during checkout.</p>`, TextBody: `${delivery.buyerEmail} sent you a ${total} gift card for ${delivery.theaterName}. Code: ${delivery.code}${delivery.message ? `\n\n${delivery.message}` : ""}`, MessageStream: "outbound" }) });
    const body = (await response.json()) as { MessageID?: string; Message?: string };
    if (!response.ok || !body.MessageID) throw new Error(`Postmark rejected the gift card delivery: ${body.Message ?? response.statusText}`);
    return { messageId: body.MessageID };
  }

  async sendRestaurantPaymentFailed(
    notice: RestaurantPaymentFailedNotice,
  ): Promise<{ messageId: string }> {
    const amountDue = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: notice.currency,
    }).format(notice.amountDueCents / 100);
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: notice.to,
        Subject: `Action needed for your ${notice.theaterName} dining tab`,
        HtmlBody: `<p>Hi ${escapeHtml(notice.customerName?.trim() || "there")},</p><p>We could not complete the ${escapeHtml(amountDue)} payment for your dining tab.</p><p><a href="${escapeHtml(notice.paymentUrl)}">Choose another payment method</a></p><p>Your tab has not been charged again automatically.</p>`,
        TextBody: `We could not complete the ${amountDue} payment for your ${notice.theaterName} dining tab. Choose another payment method: ${notice.paymentUrl}\n\nYour tab has not been charged again automatically.`,
        MessageStream: "outbound",
      }),
    });
    const body = (await response.json()) as {
      MessageID?: string;
      Message?: string;
    };
    if (!response.ok || !body.MessageID) {
      throw new Error(
        `Postmark rejected the restaurant payment notice: ${body.Message ?? response.statusText}`,
      );
    }
    return { messageId: body.MessageID };
  }

  async sendRestaurantReceipt(
    receipt: RestaurantReceiptDelivery,
  ): Promise<{ messageId: string }> {
    const money = (cents: number) => new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: receipt.currency,
    }).format(cents / 100);
    const itemHtml = receipt.items
      .map(
        (item) =>
          `<li>${item.quantity}× ${escapeHtml(item.name)} — ${escapeHtml(money(item.totalCents))}</li>`,
      )
      .join("");
    const itemText = receipt.items
      .map((item) => `${item.quantity}x ${item.name} — ${money(item.totalCents)}`)
      .join("\n");
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: receipt.to,
        Subject: `Your ${receipt.theaterName} dining receipt`,
        HtmlBody: `<p>Hi ${escapeHtml(receipt.customerName?.trim() || "there")},</p><p>Thanks for dining with us. Receipt <strong>${escapeHtml(receipt.receiptNumber)}</strong> is paid.</p><h2>Items</h2><ul>${itemHtml}</ul><h2>Totals</h2><ul><li>Subtotal: ${escapeHtml(money(receipt.subtotalCents))}</li><li>Tax: ${escapeHtml(money(receipt.taxCents))}</li><li>Service charge: ${escapeHtml(money(receipt.serviceChargeCents))}</li><li>Tip: ${escapeHtml(money(receipt.tipCents))}</li></ul><p><strong>Total: ${escapeHtml(money(receipt.totalCents))}</strong></p>`,
        TextBody: `Receipt ${receipt.receiptNumber} is paid.\n\nItems\n${itemText}\n\nSubtotal: ${money(receipt.subtotalCents)}. Tax: ${money(receipt.taxCents)}. Service charge: ${money(receipt.serviceChargeCents)}. Tip: ${money(receipt.tipCents)}. Total: ${money(receipt.totalCents)}.`,
        MessageStream: "outbound",
      }),
    });
    const body = (await response.json()) as { MessageID?: string; Message?: string };
    if (!response.ok || !body.MessageID) {
      throw new Error(`Postmark rejected the restaurant receipt: ${body.Message ?? response.statusText}`);
    }
    return { messageId: body.MessageID };
  }
}
