import { z } from "zod";

export const createGiftCardPurchaseSchema = z.object({
  locationId: z.string().uuid(), amountCents: z.number().int().min(500).max(100_000),
  buyerEmail: z.string().email().max(320), recipientName: z.string().trim().min(1).max(120).optional(),
  recipientEmail: z.string().email().max(320), message: z.string().trim().max(500).optional(),
}).strict();
