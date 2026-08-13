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
    startsAt: Date;
  }>;
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

export interface EmailProvider {
  readonly name: string;
  sendTicketReceipt(receipt: TicketReceipt): Promise<{ messageId: string }>;
  sendGiftCardDelivery(delivery: GiftCardDelivery): Promise<{ messageId: string }>;
  sendRestaurantPaymentFailed(
    notice: RestaurantPaymentFailedNotice,
  ): Promise<{ messageId: string }>;
  sendRestaurantReceipt(
    receipt: RestaurantReceiptDelivery,
  ): Promise<{ messageId: string }>;
}
