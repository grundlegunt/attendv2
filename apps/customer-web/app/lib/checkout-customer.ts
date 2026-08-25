// Import the token module directly so the customer-site serverless bundle does
// not pull in @cinema/auth's native password-hashing dependency.
import { verifyAccessToken } from "@cinema/auth/src/tokens";
import { prisma } from "@cinema/database";

const CUSTOMER_ACCESS_COOKIE = "attend_customer_access";

export class CheckoutSessionError extends Error {
  constructor() {
    super("Your account session has expired. Please sign in again.");
    this.name = "CheckoutSessionError";
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }

  return undefined;
}

export async function trustedCheckoutCustomer(
  request: Request,
  requestedEmail: string,
): Promise<{ email: string; customerId?: string }> {
  const token = readCookie(request, CUSTOMER_ACCESS_COOKIE);
  if (!token) return { email: requestedEmail };

  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new CheckoutSessionError();

  let actor;
  try {
    actor = verifyAccessToken(token, secret);
  } catch {
    throw new CheckoutSessionError();
  }
  if (actor.actorType !== "CUSTOMER" || !Number.isInteger(actor.tokenVersion)) {
    throw new CheckoutSessionError();
  }

  const customer = await prisma.customer.findFirst({
    where: {
      id: actor.sub,
      authAccount: {
        is: { emailVerifiedAt: { not: null }, refreshTokenVersion: actor.tokenVersion },
      },
    },
    select: { email: true },
  });
  if (!customer?.email) throw new CheckoutSessionError();

  return { email: customer.email, customerId: actor.sub };
}
