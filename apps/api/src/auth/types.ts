import { AccessTokenPayload } from "@cinema/auth";

/** The shape attached to `request.actor` once JwtAuthGuard has run. */
export type RequestActor = AccessTokenPayload;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: RequestActor;
      requestId?: string;
    }
  }
}
