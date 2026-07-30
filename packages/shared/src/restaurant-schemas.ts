import { z } from "zod";

export const openSeatLinkedTabsRequestSchema = z.object({
  ticketOrderId: z.string().uuid(),
  mode: z.enum(["SHARED", "SEPARATE"]),
});

export type OpenSeatLinkedTabsRequest = z.infer<
  typeof openSeatLinkedTabsRequestSchema
>;
