import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = "at1";

export function createTicketCredential(ticketId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ ticketId }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest("base64url");
  return `${VERSION}.${payload}.${signature}`;
}

export function verifyTicketCredential(
  credential: string,
  secret: string,
): { ticketId: string } | null {
  const [version, payload, signature] = credential.split(".");
  if (version !== VERSION || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(`${version}.${payload}`).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("ticketId" in decoded) ||
      typeof decoded.ticketId !== "string"
    ) return null;
    return { ticketId: decoded.ticketId };
  } catch {
    return null;
  }
}
