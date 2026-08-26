import { z } from "zod/v3";

export const createDonationCheckoutSchema = z.object({
  locationId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  amountCents: z.number().int().min(100).max(1_000_000),
  donorName: z.string().trim().min(1).max(120).optional(),
  donorEmail: z.string().trim().email().max(320),
}).strict();

export type CreateDonationCheckoutInput = z.infer<typeof createDonationCheckoutSchema>;
