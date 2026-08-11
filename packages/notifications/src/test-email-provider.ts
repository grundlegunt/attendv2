import { EmailProvider, GiftCardDelivery, TicketReceipt } from "./email-provider";

export class TestEmailProvider implements EmailProvider {
  readonly name = "test";
  readonly sent: TicketReceipt[] = [];
  readonly sentGiftCards: GiftCardDelivery[] = [];

  async sendTicketReceipt(receipt: TicketReceipt) {
    this.sent.push(receipt);
    return { messageId: `test-message-${this.sent.length}` };
  }

  async sendGiftCardDelivery(delivery: GiftCardDelivery) {
    this.sentGiftCards.push(delivery);
    return { messageId: `test-gift-card-${this.sentGiftCards.length}` };
  }
}
