export class TicketingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }

  static validation(message: string) {
    return new TicketingError("VALIDATION_FAILED", message, 400);
  }

  static notFound(message: string) {
    return new TicketingError("NOT_FOUND", message, 404);
  }

  static conflict(message: string, code = "CONFLICT") {
    return new TicketingError(code, message, 409);
  }

  static paymentRequired(message: string) {
    return new TicketingError("PAYMENT_NOT_SUCCEEDED", message, 402);
  }
}
