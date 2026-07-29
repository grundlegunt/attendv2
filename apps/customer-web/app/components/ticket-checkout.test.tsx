import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TicketCheckout } from "./ticket-checkout";
import { apiFetch } from "../lib/api-client";

jest.mock("../lib/api-client", () => ({
  apiFetch: jest.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    body: { code: string; message: string };
    constructor(status: number, body: { code: string; message: string }) {
      super(body.message);
      this.status = status;
      this.body = body;
    }
  },
}));

const mockedApiFetch = apiFetch as jest.Mock;

/**
 * A minimal, controllable double for the real Stripe.js SDK -- real
 * Stripe.js is loaded from an external <script> tag and talks to Stripe's
 * servers, neither of which belongs in a unit test. `loadStripe()` in the
 * component under test already short-circuits when `window.Stripe` is
 * already set, which is what makes this double possible without touching
 * the real script-loading path at all.
 */
function installFakeStripe() {
  let readyCallback: (() => void) | undefined;
  const paymentElement = {
    mount: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn((event: string, callback: () => void) => {
      if (event === "ready") readyCallback = callback;
    }),
  };
  const elements = { create: jest.fn(() => paymentElement) };
  const stripeClient = { elements: jest.fn(() => elements), confirmPayment: jest.fn() };
  const stripeFactory = jest.fn(() => stripeClient);
  (window as unknown as { Stripe: typeof stripeFactory }).Stripe = stripeFactory;
  return {
    paymentElement,
    triggerReady: () => {
      if (!readyCallback) throw new Error("Payment Element's ready handler was never registered.");
      readyCallback();
    },
  };
}

const defaultProps = {
  showtimeId: "showtime-1",
  holdTokens: ["11111111-1111-1111-1111-111111111111"],
  holderKey: "holder-key-0123456789",
  seats: ["A1"],
  movie: "Test Movie",
  auditorium: "Auditorium 1",
  startsAt: "2030-01-01T18:00:00.000Z",
  onBack: jest.fn(),
};

describe("TicketCheckout payment element readiness", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  afterEach(() => {
    delete (window as { Stripe?: unknown }).Stripe;
  });

  it("keeps the Pay button disabled and shows a loading message until the Payment Element fires ready, then enables it", async () => {
    const { paymentElement, triggerReady } = installFakeStripe();

    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path.includes("/checkout-config")) {
        return {
          currency: "usd",
          ticketTypes: [{ id: "ticket-type-1", name: "Adult" }],
          payment: { ready: true, publishableKey: "pk_test_fake", connectedAccountId: null },
        };
      }
      if (path === "/ticketing/checkouts") {
        return {
          orderId: "order-1",
          orderNumber: "AT-TEST",
          status: "AWAITING_PAYMENT",
          subtotalCents: 1500,
          feesCents: 200,
          taxCents: 0,
          totalCents: 1700,
          currency: "usd",
          payment: {
            id: "payment-1",
            providerPaymentId: "pi_fake_1",
            status: "REQUIRES_PAYMENT_METHOD",
            clientSecret: "pi_fake_1_secret",
            attemptNumber: 1,
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${path}`);
    });

    render(<TicketCheckout {...defaultProps} />);

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining("/checkout-config")),
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "guest@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => expect(paymentElement.mount).toHaveBeenCalled());

    // Before the Payment Element reports itself ready: loading message
    // shown, Pay button disabled.
    expect(screen.getByText("Loading secure payment form…")).toBeInTheDocument();
    const payButton = screen.getByRole("button", { name: /^Pay /i });
    expect(payButton).toBeDisabled();
    expect(screen.getByText("Choose a payment method")).toBeInTheDocument();

    act(() => {
      triggerReady();
    });

    // After ready: loading message gone, Pay button enabled.
    expect(screen.queryByText("Loading secure payment form…")).not.toBeInTheDocument();
    expect(payButton).toBeEnabled();
  });
});
