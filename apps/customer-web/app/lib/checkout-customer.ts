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

export async function trustedCheckoutEmail(
  request: Request,
  requestedEmail: string,
): Promise<string> {
  const token = readCookie(request, CUSTOMER_ACCESS_COOKIE);
  if (!token) return requestedEmail;

  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new CheckoutSessionError();

  let actor;
  try {
    actor = verifyAccessToken(token, secret);
  } catch {
    throw new CheckoutSessionError();
  }
  if (actor.actorType !== "CUSTOMER") throw new CheckoutSessionError();

  const customer = await prisma.customer.findFirst({
    where: { id: actor.sub, authAccount: { isNot: null } },
    select: { email: true },
  });
  if (!customer?.email) throw new CheckoutSessionError();

  return customer.email;
}
