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

export interface EmailProvider {
  readonly name: string;
  sendTicketReceipt(receipt: TicketReceipt): Promise<{ messageId: string }>;
}
