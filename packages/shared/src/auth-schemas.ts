import { z } from "zod";

/**
 * Request/response contracts for the auth endpoints, shared between
 * apps/api and every frontend so a shape never drifts between them. See
 * AGENTS.md §8 — this is the single source of truth for these shapes.
 */

export const staffLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;

export const platformLoginRequestSchema = staffLoginRequestSchema;
export type PlatformLoginRequest = z.infer<typeof platformLoginRequestSchema>;

export const customerRegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});
export type CustomerRegisterRequest = z.infer<typeof customerRegisterRequestSchema>;

export const customerLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type CustomerLoginRequest = z.infer<typeof customerLoginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AuthenticatedEmployee {
  id: string;
  name: string;
  email: string;
  locationId: string;
  roles: string[];
  permissions: string[];
  timeClockEnabled: boolean;
}

export interface AuthenticatedCustomer {
  id: string;
  email: string | null;
  name: string | null;
  isGuest: boolean;
}

export interface AuthenticatedPlatformUser {
  id: string;
  name: string;
  email: string;
}

export interface CustomerTicketSummary {
  id: string;
  status: string;
  qrToken: string;
  priceCentsPaid: number;
  seatLabel: string;
  movieTitle: string;
  moviePosterUrl: string | null;
  auditoriumName: string;
  startsAt: string;
}

export interface CustomerTicketOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  locationName: string;
  tickets: CustomerTicketSummary[];
}

export interface CustomerAccountResponse {
  customer: AuthenticatedCustomer;
  orders: CustomerTicketOrderSummary[];
}
