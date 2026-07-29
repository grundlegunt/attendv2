import { z } from "zod";

export const createTicketCheckoutRequestSchema = z.object({
  holdTokens: z.array(z.string().uuid()).min(1).max(10),
  holderKey: z.string().min(16).max(200),
  ticketTypeId: z.string().uuid(),
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(120).optional(),
  diningAuthorizationRequested: z.boolean(),
});

export type CreateTicketCheckoutRequest = z.infer<
  typeof createTicketCheckoutRequestSchema
>;

export interface TicketCheckoutResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  subtotalCents: number;
  feesCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  payment: {
    id: string;
    providerPaymentId: string | null;
    status: string;
    clientSecret?: string;
    attemptNumber: number;
  } | null;
}

export interface TicketConfirmationResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  tickets: Array<{
    id: string;
    issuanceToken: string;
    seat: string;
    movie: string;
    auditorium: string;
    startsAt: string;
  }>;
}

export const scanTicketRequestSchema = z.object({
  credential: z.string().trim().min(1).max(2048),
  expectedShowtimeId: z.string().uuid().optional(),
  deviceId: z.string().trim().min(1).max(120).optional(),
  entrance: z.string().trim().min(1).max(120).optional(),
});

export type ScanTicketRequest = z.infer<typeof scanTicketRequestSchema>;

export type TicketScanResult =
  | "VALID"
  | "ALREADY_USED"
  | "WRONG_SHOWTIME"
  | "REFUNDED"
  | "CANCELED"
  | "INVALID";

export interface TicketScanResponse {
  result: TicketScanResult;
  scannedAt: string;
  ticket: {
    id: string;
    movie: string;
    auditorium: string;
    showtimeId: string;
    startsAt: string;
    seat: string;
    ticketType: string;
  } | null;
}
