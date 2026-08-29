import { Inject, Injectable } from "@nestjs/common";
import { PaymentAttemptStatus, PaymentPurpose, PaymentStatus, Prisma, prisma } from "@cinema/database";
import type { PaymentProvider, VerifiedProviderEvent } from "@cinema/payments";
import type { EmailProvider } from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";

function paymentStatus(status: string) {
  return status === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : status === "PROCESSING" ? PaymentStatus.PROCESSING : status === "REQUIRES_ACTION" ? PaymentStatus.REQUIRES_ACTION : status === "FAILED" ? PaymentStatus.FAILED : PaymentStatus.REQUIRES_PAYMENT_METHOD;
}
function attemptStatus(status: string) {
  return status === "SUCCEEDED" ? PaymentAttemptStatus.SUCCEEDED : status === "PROCESSING" ? PaymentAttemptStatus.PROCESSING : status === "REQUIRES_ACTION" ? PaymentAttemptStatus.REQUIRES_ACTION : status === "FAILED" ? PaymentAttemptStatus.FAILED : PaymentAttemptStatus.CREATED;
}
function unique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; }

@Injectable()
export class DonationCheckoutService {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider, @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {}

  async config(locationId?: string) {
    const location = await prisma.location.findFirst({
      where: { ...(locationId ? { id: locationId } : {}), active: true, organization: { active: true } },
      orderBy: { createdAt: "asc" }, include: { organization: true },
    });
    if (!location) throw AppError.notFound("Location was not found.");
    const now = new Date();
    const campaigns = await prisma.donationCampaign.findMany({ where: { organizationId: location.organizationId, active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] }, select: { id: true, name: true, description: true, goalAmountCents: true }, orderBy: { createdAt: "desc" } });
    const env = loadEnv();
    return { locationId: location.id, organizationName: location.organization.name, currency: location.currency, campaigns, payment: { ready: Boolean(env.PAYMENT_PROVIDER === "stripe" && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_SECRET_KEY && location.organization.stripeConnectedAccountId), publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null, connectedAccountId: location.organization.stripeConnectedAccountId } };
  }

  async create(input: { idempotencyKey: string; locationId: string; campaignId?: string; amountCents: number; donorName?: string; donorEmail: string }) {
    if (input.idempotencyKey.length < 16) throw AppError.validationFailed("A valid donation idempotency key is required.");
    const existing = await prisma.donationCheckout.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payment: true, location: { include: { organization: true } } } });
    if (existing) { this.assertReplay(existing, input); return this.complete(existing); }
    const location = await prisma.location.findFirst({ where: { id: input.locationId, active: true, organization: { active: true } }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    if (input.campaignId) {
      const now = new Date();
      const campaign = await prisma.donationCampaign.findFirst({ where: { id: input.campaignId, organizationId: location.organizationId, active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] } });
      if (!campaign) throw AppError.validationFailed("Donation campaign is not available.");
    }
    let checkout: Checkout;
    try {
      checkout = await prisma.donationCheckout.create({ data: { organization: { connect: { id: location.organizationId } }, location: { connect: { id: location.id } }, ...(input.campaignId ? { campaign: { connect: { id: input.campaignId } } } : {}), donorName: input.donorName, donorEmail: input.donorEmail.toLowerCase(), amountCents: input.amountCents, currency: location.currency, idempotencyKey: input.idempotencyKey, payment: { create: { purpose: PaymentPurpose.DONATION, amountCents: input.amountCents, currency: location.currency, status: PaymentStatus.CREATED, idempotencyKey: `donation:${input.idempotencyKey}`, provider: this.provider.name } } }, include: { payment: true, location: { include: { organization: true } } } });
    } catch (error) {
      if (!unique(error)) throw error;
      checkout = await prisma.donationCheckout.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey }, include: { payment: true, location: { include: { organization: true } } } });
      this.assertReplay(checkout, input);
    }
    return this.complete(checkout);
  }

  async resume(key: string) {
    if (key.length < 16) throw AppError.notFound("Donation checkout was not found.");
    const checkout = await prisma.donationCheckout.findUnique({ where: { idempotencyKey: key }, include: { payment: true, location: { include: { organization: true } } } });
    if (!checkout) throw AppError.notFound("Donation checkout was not found.");
    return this.complete(checkout);
  }

  private async complete(checkout: Checkout) {
    if (checkout.payment.providerPaymentId) {
      const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: checkout.payment.providerPaymentId });
      await prisma.payment.update({ where: { id: checkout.paymentId }, data: { status: paymentStatus(intent.status) } });
      return this.present(checkout, intent.clientSecret, intent.status);
    }
    const intent = await this.provider.createPaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, amountCents: checkout.amountCents, currency: checkout.currency, metadata: { donationCheckoutId: checkout.id, organizationId: checkout.organizationId, locationId: checkout.locationId }, idempotencyKey: checkout.payment.idempotencyKey });
    const updated = await prisma.donationCheckout.update({ where: { id: checkout.id }, data: { payment: { update: { providerPaymentId: intent.id, status: paymentStatus(intent.status), attempts: { create: { provider: this.provider.name, providerIntentId: intent.id, attemptNumber: 1, status: attemptStatus(intent.status) } } } } }, include: { payment: true, location: { include: { organization: true } } } });
    return this.present(updated, intent.clientSecret, intent.status);
  }

  async finalize(id: string, key: string) {
    const checkout = await prisma.donationCheckout.findUnique({ where: { id }, include: { payment: true, location: { include: { organization: true } }, campaign: true } });
    if (!checkout || key.length < 16 || checkout.idempotencyKey !== key) throw AppError.notFound("Donation checkout was not found.");
    if (checkout.donationId) return this.confirmation(checkout);
    if (!checkout.payment.providerPaymentId) throw AppError.notFound("Donation checkout was not found.");
    const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: checkout.payment.providerPaymentId });
    if (intent.status !== "SUCCEEDED") throw AppError.paymentRequired(intent.failureMessage ?? "Payment has not completed.");
    if (intent.amountCents !== checkout.amountCents || intent.currency.toLowerCase() !== checkout.currency.toLowerCase() || intent.metadata.donationCheckoutId !== checkout.id) throw AppError.conflict("Payment verification failed and requires manual review.");
    const settled = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "donation_checkouts" WHERE "id" = ${checkout.id} FOR UPDATE`);
      const locked = await tx.donationCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      if (locked.donationId) return tx.donationCheckout.findUniqueOrThrow({ where: { id: checkout.id }, include: { payment: true, location: { include: { organization: true } }, campaign: true } });
      const customer = await tx.customer.findFirst({
        where: { email: checkout.donorEmail, deletedAt: null },
        select: { id: true },
      });
      const donation = await tx.donation.create({ data: { locationId: checkout.locationId, campaignId: checkout.campaignId, customerId: customer?.id, donorName: checkout.donorName, donorEmail: checkout.donorEmail, amountCents: checkout.amountCents, taxDeductibleAmountCents: checkout.amountCents, paymentMethod: "ONLINE", status: "SETTLED", externalReference: intent.id, receivedAt: new Date() } });
      await tx.payment.update({ where: { id: checkout.paymentId }, data: { status: "SUCCEEDED" } });
      await tx.donationCheckout.update({ where: { id: checkout.id }, data: { donationId: donation.id, status: "PAID" } });
      await tx.auditEvent.create({ data: { actorType: "SYSTEM", locationId: checkout.locationId, action: "donation.online_settled", entityType: "Donation", entityId: donation.id, afterState: { checkoutId: checkout.id, campaignId: checkout.campaignId, customerId: customer?.id ?? null, amountCents: checkout.amountCents } } });
      return tx.donationCheckout.findUniqueOrThrow({ where: { id: checkout.id }, include: { payment: true, location: { include: { organization: true } }, campaign: true } });
    });
    await this.sendReceipt(settled);
    return this.confirmation(settled);
  }

  async processVerifiedWebhook(event: VerifiedProviderEvent) {
    if (!event.paymentIntentId || !event.metadata?.donationCheckoutId) return { ignored: true };
    const checkout = await prisma.donationCheckout.findUnique({ where: { id: event.metadata.donationCheckoutId } });
    if (!checkout) throw AppError.notFound("Donation checkout was not found.");
    if (event.type === "payment_intent.succeeded") await this.finalize(checkout.id, checkout.idempotencyKey);
    else if (event.type === "payment_intent.payment_failed") await prisma.donationCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED", payment: { update: { status: "FAILED" } } } });
    return { processed: true };
  }

  private async sendReceipt(checkout: CheckoutWithCampaign) {
    const now = new Date();
    const claim = await prisma.donationCheckout.updateMany({
      where: {
        id: checkout.id,
        receiptSentAt: null,
        OR: [{ receiptClaimedAt: null }, { receiptClaimedAt: { lt: new Date(now.getTime() - 60_000) } }],
      },
      data: { receiptClaimedAt: now },
    });
    if (claim.count === 0) return;
    try {
      const sent = await this.email.sendDonationReceipt({ to: checkout.donorEmail, donorName: checkout.donorName, organizationName: checkout.location.organization.name, campaignName: checkout.campaign?.name, amountCents: checkout.amountCents, currency: checkout.currency, donationId: checkout.donationId! });
      await prisma.donationCheckout.updateMany({
        where: { id: checkout.id, receiptClaimedAt: now, receiptSentAt: null },
        data: { receiptMessageId: sent.messageId, receiptSentAt: new Date(), receiptClaimedAt: null, receiptError: null },
      });
    } catch (error) {
      await prisma.donationCheckout.updateMany({
        where: { id: checkout.id, receiptClaimedAt: now, receiptSentAt: null },
        data: { receiptClaimedAt: null, receiptError: error instanceof Error ? error.message : "Receipt delivery failed." },
      });
    }
  }

  private assertReplay(checkout: Checkout, input: { locationId: string; campaignId?: string; amountCents: number; donorName?: string; donorEmail: string }) {
    if (checkout.locationId !== input.locationId || checkout.campaignId !== (input.campaignId ?? null) || checkout.amountCents !== input.amountCents || checkout.donorName !== (input.donorName ?? null) || checkout.donorEmail !== input.donorEmail.toLowerCase()) throw AppError.conflict("The donation idempotency key was already used with different details.");
  }
  private present(checkout: Checkout, clientSecret?: string, providerStatus?: string) { return { checkoutId: checkout.id, status: checkout.status, amountCents: checkout.amountCents, currency: checkout.currency, donorEmail: checkout.donorEmail, payment: { status: providerStatus ?? checkout.payment.status, clientSecret } }; }
  private confirmation(checkout: CheckoutWithCampaign) { return { checkoutId: checkout.id, donationId: checkout.donationId, status: checkout.status, amountCents: checkout.amountCents, currency: checkout.currency, campaignName: checkout.campaign?.name ?? null }; }
}

type Checkout = Prisma.DonationCheckoutGetPayload<{ include: { payment: true; location: { include: { organization: true } } } }>;
type CheckoutWithCampaign = Prisma.DonationCheckoutGetPayload<{ include: { payment: true; location: { include: { organization: true } }; campaign: true } }>;
