export interface TicketReceipt {
  to: string;
  guestName?: string | null;
  orderNumber: string;
  totalCents: number;
  currency: string;
  tickets: Array<{
    id: string;
    credential: string;
    movie: string;
    auditorium: string;
    seat: string;
    ticketType: string;
    startsAt: Date;
  }>;
  orderAhead?: {
    subtotalCents: number;
    taxCents: number;
    serviceChargeCents: number;
    items: Array<{
      name: string;
      quantity: number;
      totalCents: number;
    }>;
  };
}

export interface GiftCardDelivery {
  to: string;
  recipientName?: string | null;
  buyerEmail: string;
  theaterName: string;
  amountCents: number;
  currency: string;
  code: string;
  message?: string | null;
}

export interface DonationReceiptDelivery {
  to: string;
  donorName?: string | null;
  organizationName: string;
  campaignName?: string | null;
  amountCents: number;
  currency: string;
  donationId: string;
}

export interface MembershipReceiptDelivery {
  to: string;
  memberName: string;
  organizationName: string;
  planName: string;
  membershipNumber: string;
  expiresAt: Date | null;
  amountCents: number;
  currency: string;
}

export interface RestaurantPaymentFailedNotice {
  to: string;
  customerName?: string | null;
  theaterName: string;
  tabId: string;
  amountDueCents: number;
  currency: string;
  paymentUrl: string;
}

export interface RestaurantReceiptDelivery {
  to: string;
  customerName?: string | null;
  theaterName: string;
  receiptNumber: string;
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  tipCents: number;
  totalCents: number;
  currency: string;
  items: Array<{
    name: string;
    quantity: number;
    totalCents: number;
  }>;
}

export interface CustomerPasswordResetDelivery {
  to: string;
  customerName?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface CustomerEmailChangeDelivery {
  to: string;
  customerName?: string | null;
  verificationUrl: string;
  expiresInMinutes: number;
}

export interface ShowtimeWaitlistDelivery {
  to: string;
  theaterName: string;
  movieTitle: string;
  startsAt: Date;
  timeZone: string;
  purchaseUrl: string;
}

export interface EmailProvider {
  readonly name: string;
  sendTicketReceipt(receipt: TicketReceipt): Promise<{ messageId: string }>;
  sendGiftCardDelivery(delivery: GiftCardDelivery): Promise<{ messageId: string }>;
  sendDonationReceipt(receipt: DonationReceiptDelivery): Promise<{ messageId: string }>;
  sendMembershipReceipt(receipt: MembershipReceiptDelivery): Promise<{ messageId: string }>;
  sendRestaurantPaymentFailed(
    notice: RestaurantPaymentFailedNotice,
  ): Promise<{ messageId: string }>;
  sendRestaurantReceipt(
    receipt: RestaurantReceiptDelivery,
  ): Promise<{ messageId: string }>;
  sendCustomerPasswordReset(
    delivery: CustomerPasswordResetDelivery,
  ): Promise<{ messageId: string }>;
  sendCustomerEmailChange(
    delivery: CustomerEmailChangeDelivery,
  ): Promise<{ messageId: string }>;
  sendShowtimeWaitlistAvailability(
    delivery: ShowtimeWaitlistDelivery,
  ): Promise<{ messageId: string }>;
}
