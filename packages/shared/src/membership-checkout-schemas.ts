import { z } from "zod/v3";

export const createMembershipCheckoutSchema = z.object({
  locationId: z.string().uuid(),
  planId: z.string().uuid(),
  memberName: z.string().trim().min(1).max(120),
  memberEmail: z.string().trim().email().max(320),
}).strict();

export type CreateMembershipCheckoutInput = z.infer<typeof createMembershipCheckoutSchema>;
