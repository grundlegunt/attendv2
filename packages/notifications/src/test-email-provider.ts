import {
  EmailProvider,
  GiftCardDelivery,
  RestaurantPaymentFailedNotice,
  RestaurantReceiptDelivery,
  CustomerPasswordResetDelivery,
  CustomerEmailChangeDelivery,
  ShowtimeWaitlistDelivery,
  TicketReceipt,
} from "./email-provider";

export class TestEmailProvider implements EmailProvider {
  readonly name = "test";
  readonly sent: TicketReceipt[] = [];
  readonly sentGiftCards: GiftCardDelivery[] = [];
  readonly sentRestaurantPaymentFailures: RestaurantPaymentFailedNotice[] = [];
  readonly sentRestaurantReceipts: RestaurantReceiptDelivery[] = [];
  readonly sentCustomerPasswordResets: CustomerPasswordResetDelivery[] = [];
  readonly sentCustomerEmailChanges: CustomerEmailChangeDelivery[] = [];
  readonly sentShowtimeWaitlistAvailability: ShowtimeWaitlistDelivery[] = [];

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

  async sendRestaurantReceipt(receipt: RestaurantReceiptDelivery) {
    this.sentRestaurantReceipts.push(receipt);
    return { messageId: `test-restaurant-receipt-${this.sentRestaurantReceipts.length}` };
  }

  async sendCustomerPasswordReset(delivery: CustomerPasswordResetDelivery) {
    this.sentCustomerPasswordResets.push(delivery);
    return { messageId: `test-customer-password-reset-${this.sentCustomerPasswordResets.length}` };
  }

  async sendCustomerEmailChange(delivery: CustomerEmailChangeDelivery) {
    this.sentCustomerEmailChanges.push(delivery);
    return { messageId: `test-customer-email-change-${this.sentCustomerEmailChanges.length}` };
  }

  async sendShowtimeWaitlistAvailability(delivery: ShowtimeWaitlistDelivery) {
    this.sentShowtimeWaitlistAvailability.push(delivery);
    return { messageId: `test-showtime-waitlist-${this.sentShowtimeWaitlistAvailability.length}` };
  }
}
