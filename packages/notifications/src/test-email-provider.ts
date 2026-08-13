import {
  EmailProvider,
  GiftCardDelivery,
  RestaurantPaymentFailedNotice,
  TicketReceipt,
} from "./email-provider";

export class TestEmailProvider implements EmailProvider {
  readonly name = "test";
  readonly sent: TicketReceipt[] = [];
  readonly sentGiftCards: GiftCardDelivery[] = [];
  readonly sentRestaurantPaymentFailures: RestaurantPaymentFailedNotice[] = [];

  async sendTicketReceipt(receipt: TicketReceipt) {
    this.sent.push(receipt);
    return { messageId: `test-message-${this.sent.length}` };
  }

  async sendGiftCardDelivery(delivery: GiftCardDelivery) {
    this.sentGiftCards.push(delivery);
    return { messageId: `test-gift-card-${this.sentGiftCards.length}` };
  }

  async sendRestaurantPaymentFailed(notice: RestaurantPaymentFailedNotice) {
    this.sentRestaurantPaymentFailures.push(notice);
    return {
      messageId: `test-restaurant-payment-failed-${this.sentRestaurantPaymentFailures.length}`,
    };
  }
}
