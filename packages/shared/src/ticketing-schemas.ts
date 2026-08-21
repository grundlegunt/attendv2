import { z } from "zod";

export const createTicketCheckoutRequestSchema = z.object({
  holdTokens: z.array(z.string().uuid()).min(1).max(10),
  holderKey: z.string().min(16).max(200),
  ticketTypeId: z.string().uuid(),
  ticketTypeSelections: z
    .array(z.object({ holdToken: z.string().uuid(), ticketTypeId: z.string().uuid() }).strict())
    .min(1)
    .max(10)
    .optional(),
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(120).optional(),
  zipCode: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code.")
    .optional(),
  promotionCode: z.string().trim().min(1).max(50).optional(),
  giftCardCode: z.string().trim().min(20).max(40).optional(),
  diningAuthorizationRequested: z.boolean(),
  orderAhead: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
        modifierIds: z.array(z.string().uuid()).max(20),
      }),
    )
    .max(50)
    .optional(),
});

export type CreateTicketCheckoutRequest = z.infer<
  typeof createTicketCheckoutRequestSchema
>;

export const resumeTicketCheckoutRequestSchema = z.object({
  holderKey: z.string().min(16).max(200),
}).strict();

export type ResumeTicketCheckoutRequest = z.infer<
  typeof resumeTicketCheckoutRequestSchema
>;

export const finalizeTicketOrderRequestSchema = z.object({
  holderKey: z.string().min(16).max(200),
}).strict();

export interface TicketCheckoutResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  email: string | null;
  name: string | null;
  subtotalCents: number;
  discountCents: number;
  feesCents: number;
  taxCents: number;
  orderAheadSubtotalCents: number;
  orderAheadTaxCents: number;
  orderAheadServiceChargeCents: number;
  totalCents: number;
  giftCardCents: number;
  currency: string;
  promotion: { code: string; name: string } | null;
  payment: {
    id: string;
    providerPaymentId: string | null;
    status: string;
    amountCents: number;
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
  receiptDelivery: "SENT" | "FAILED" | "NOT_REQUESTED";
  diningAuthorization: "AUTHORIZED" | "DECLINED" | "UNAVAILABLE";
  tickets: Array<{
    id: string;
    issuanceToken: string;
    seat: string;
    ticketType: string;
    movie: string;
    auditorium: string;
    startsAt: string;
    endsAt: string;
  }>;
}

export const resendGuestTicketReceiptRequestSchema = z.object({
  holderKey: z.string().min(16).max(200),
  requestId: z.string().uuid(),
}).strict();
export type ResendGuestTicketReceiptRequest = z.infer<
  typeof resendGuestTicketReceiptRequestSchema
>;

export const scanTicketRequestSchema = z.object({
  credential: z.string().trim().min(1).max(2048),
  expectedShowtimeId: z.string().uuid(),
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
