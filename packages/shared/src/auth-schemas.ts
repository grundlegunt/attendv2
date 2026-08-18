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

export const staffMfaVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
}).strict();
export type StaffMfaVerifyRequest = z.infer<typeof staffMfaVerifyRequestSchema>;

export const staffMfaConfirmRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
}).strict();
export type StaffMfaConfirmRequest = z.infer<typeof staffMfaConfirmRequestSchema>;

export const staffPasswordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(200),
}).strict();
export type StaffPasswordChangeRequest = z.infer<typeof staffPasswordChangeRequestSchema>;

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

export const customerPasswordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
}).strict();
export type CustomerPasswordChangeRequest = z.infer<typeof customerPasswordChangeRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface CustomerSessionResponse {
  customer: AuthenticatedCustomer;
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
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  adminBranding: {
    accentColor: string | null;
    accentMutedColor: string | null;
    backgroundColor: string | null;
    surfaceColor: string | null;
    textColor: string | null;
    mutedTextColor: string | null;
  };
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
