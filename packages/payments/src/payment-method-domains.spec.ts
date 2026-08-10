import Stripe from "stripe";
import { registerConnectedAccountPaymentMethodDomains } from "./payment-method-domains";

describe("registerConnectedAccountPaymentMethodDomains", () => {
  it("registers only missing domains on the connected account", async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ domain_name: "attendv2.vercel.app" }],
    });
    const create = jest.fn().mockResolvedValue({});
    const stripe = {
      paymentMethodDomains: { list, create },
    } as unknown as Stripe;

    const created = await registerConnectedAccountPaymentMethodDomains(
      "unused-test-key",
      [{
        connectedAccountId: "acct_cinema",
        domains: [
          "attendv2.vercel.app",
          "attendv2-preview.vercel.app",
        ],
      }],
      stripe,
    );

    expect(created).toBe(1);
    expect(list).toHaveBeenCalledWith(
      { limit: 100 },
      { stripeAccount: "acct_cinema" },
    );
    expect(create).toHaveBeenCalledWith(
      { domain_name: "attendv2-preview.vercel.app" },
      { stripeAccount: "acct_cinema" },
    );
  });
});
