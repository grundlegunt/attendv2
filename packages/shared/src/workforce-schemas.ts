import { z } from "zod";

export const shiftPinRequestSchema = z.object({
  locationId: z.string().uuid(),
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must contain 4 to 8 digits."),
});

export const shiftManagerAdjustmentSchema = z.object({
  clockInAt: z.string().datetime().optional(),
  clockOutAt: z.string().datetime().nullable().optional(),
  breakStartAt: z.string().datetime().nullable().optional(),
  breakEndAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().min(1).max(500),
});

export const openCashDrawerRequestSchema = z.object({
  registerId: z.string().trim().min(1).max(100),
  openingBalanceCents: z.number().int().nonnegative(),
});

export const closeCashDrawerRequestSchema = z.object({
  closingBalanceCents: z.number().int().nonnegative(),
});

export const cashMovementRequestSchema = z.object({
  type: z.enum(["PAID_IN", "PAID_OUT"]),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().uuid(),
});

export const boxOfficeHoldRequestSchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(10),
  holderKey: z.string().min(16).max(200),
});

export const boxOfficeQuoteRequestSchema = z.object({
  holdTokens: z.array(z.string().uuid()).min(1).max(10),
  holderKey: z.string().min(16).max(200),
  promotionCode: z.string().trim().min(1).max(50).optional(),
});

export const boxOfficeCheckoutRequestSchema = boxOfficeQuoteRequestSchema.extend({
  requestId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  cashDrawerId: z.string().uuid().optional(),
  cashCents: z.number().int().nonnegative().default(0),
  cardCents: z.number().int().nonnegative().default(0),
  giftCardCents: z.number().int().nonnegative().default(0),
  giftCardCode: z.string().trim().min(20).max(40).optional(),
  readerId: z.string().trim().min(1).max(200).optional(),
  cashReceivedCents: z.number().int().nonnegative().optional(),
  customerEmail: z.string().email().max(320).optional(),
  customerName: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, context) => {
  if (value.cashCents > 0 && !value.cashDrawerId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cashDrawerId"], message: "An open cash drawer is required for cash tender." });
  }
  if (value.cardCents > 0 && !value.readerId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["readerId"], message: "A Terminal reader is required for card tender." });
  }
  if (value.giftCardCents > 0 && !value.giftCardCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["giftCardCode"], message: "A gift card code is required for gift card tender." });
  }
  if (value.giftCardCents > 0 && (value.cashCents > 0 || value.cardCents > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["giftCardCents"], message: "Gift card tender cannot yet be combined with cash or card." });
  }
  if (value.cashCents + value.cardCents + value.giftCardCents <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cashCents"], message: "At least one tender is required." });
  }
});

export const seatBlockRequestSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

export const ticketRefundRequestSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  cashDrawerId: z.string().uuid().optional(),
});

export const ticketExchangeRequestSchema = z.object({
  holdToken: z.string().uuid(),
  holderKey: z.string().min(16).max(200),
  reason: z.string().trim().min(1).max(500),
});
