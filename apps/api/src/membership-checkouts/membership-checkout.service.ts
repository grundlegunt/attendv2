import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PaymentAttemptStatus, PaymentPurpose, PaymentStatus, Prisma, prisma } from "@cinema/database";
import type { PaymentProvider, VerifiedProviderEvent } from "@cinema/payments";
import type { EmailProvider } from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";

const status = (value: string) => value === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : value === "PROCESSING" ? PaymentStatus.PROCESSING : value === "REQUIRES_ACTION" ? PaymentStatus.REQUIRES_ACTION : value === "FAILED" ? PaymentStatus.FAILED : PaymentStatus.REQUIRES_PAYMENT_METHOD;
const attempt = (value: string) => value === "SUCCEEDED" ? PaymentAttemptStatus.SUCCEEDED : value === "PROCESSING" ? PaymentAttemptStatus.PROCESSING : value === "REQUIRES_ACTION" ? PaymentAttemptStatus.REQUIRES_ACTION : value === "FAILED" ? PaymentAttemptStatus.FAILED : PaymentAttemptStatus.CREATED;
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
export const membershipExpiration = (months: number, currentExpiration: Date | null = null, now = new Date()) => {
  const base = currentExpiration && currentExpiration > now ? new Date(currentExpiration) : new Date(now);
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base;
};
export const membershipDeductibleAmount = (priceCents: number, benefitsFairMarketValueCents: number) => Math.max(0, priceCents - benefitsFairMarketValueCents);

@Injectable()
export class MembershipCheckoutService {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider, @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {}

  async config(locationId?: string) {
    const location = await prisma.location.findFirst({ where: { ...(locationId ? { id: locationId } : {}), active: true, organization: { active: true } }, orderBy: { createdAt: "asc" }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    const plans = await prisma.membershipPlan.findMany({ where: { organizationId: location.organizationId, active: true }, select: { id: true, name: true, description: true, priceCents: true, benefitsFairMarketValueCents: true, durationMonths: true, benefits: true }, orderBy: [{ priceCents: "asc" }, { name: "asc" }] });
    const env = loadEnv();
    return { locationId: location.id, organizationName: location.organization.name, currency: location.currency, plans, payment: { ready: Boolean(env.PAYMENT_PROVIDER === "stripe" && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_SECRET_KEY && location.organization.stripeConnectedAccountId), publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null, connectedAccountId: location.organization.stripeConnectedAccountId } };
  }

  async create(input: Input) {
    if (input.idempotencyKey.length < 16) throw AppError.validationFailed("A valid membership idempotency key is required.");
    const existing = await prisma.membershipCheckout.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: includeCheckout });
    if (existing) { this.assertReplay(existing, input); return this.complete(existing); }
    const location = await prisma.location.findFirst({ where: { id: input.locationId, active: true, organization: { active: true } }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    const plan = await prisma.membershipPlan.findFirst({ where: { id: input.planId, organizationId: location.organizationId, active: true } });
    if (!plan) throw AppError.validationFailed("Membership plan is not available.");
    const email = input.memberEmail.toLowerCase();
    const customer = await prisma.customer.findUnique({ where: { email }, select: { memberships: { where: { organizationId: location.organizationId }, select: { status: true } } } });
    if (customer?.memberships[0]?.status === "SUSPENDED") throw AppError.conflict("This membership is suspended. Contact the cinema before renewing it.");
    let checkout: Checkout;
    try {
      checkout = await prisma.membershipCheckout.create({ data: { organization: { connect: { id: location.organizationId } }, location: { connect: { id: location.id } }, plan: { connect: { id: plan.id } }, memberName: input.memberName, memberEmail: email, planName: plan.name, planDescription: plan.description, planBenefits: plan.benefits as Prisma.InputJsonValue, durationMonths: plan.durationMonths, amountCents: plan.priceCents, taxDeductibleAmountCents: membershipDeductibleAmount(plan.priceCents, plan.benefitsFairMarketValueCents), currency: location.currency, idempotencyKey: input.idempotencyKey, payment: { create: { purpose: PaymentPurpose.MEMBERSHIP, amountCents: plan.priceCents, currency: location.currency, status: PaymentStatus.CREATED, idempotencyKey: `membership:${input.idempotencyKey}`, provider: this.provider.name } } }, include: includeCheckout });
    } catch (error) {
      if (!isUnique(error)) throw error;
      checkout = await prisma.membershipCheckout.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey }, include: includeCheckout }); this.assertReplay(checkout, input);
    }
    return this.complete(checkout);
  }

  async resume(key: string) {
    const checkout = key.length >= 16 ? await prisma.membershipCheckout.findUnique({ where: { idempotencyKey: key }, include: includeCheckout }) : null;
    if (!checkout) throw AppError.notFound("Membership checkout was not found.");
    return this.complete(checkout);
  }

  private async complete(checkout: Checkout) {
    if (checkout.payment.providerPaymentId) {
      const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: checkout.payment.providerPaymentId });
      await prisma.payment.update({ where: { id: checkout.paymentId }, data: { status: status(intent.status) } });
      return this.present(checkout, intent.clientSecret, intent.status);
    }
    const intent = await this.provider.createPaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, amountCents: checkout.amountCents, currency: checkout.currency, metadata: { membershipCheckoutId: checkout.id, organizationId: checkout.organizationId, locationId: checkout.locationId, membershipPlanId: checkout.planId }, idempotencyKey: checkout.payment.idempotencyKey });
    const updated = await prisma.membershipCheckout.update({ where: { id: checkout.id }, data: { payment: { update: { providerPaymentId: intent.id, status: status(intent.status), attempts: { create: { provider: this.provider.name, providerIntentId: intent.id, attemptNumber: 1, status: attempt(intent.status) } } } } }, include: includeCheckout });
    return this.present(updated, intent.clientSecret, intent.status);
  }

  async finalize(id: string, key: string) {
    const checkout = await prisma.membershipCheckout.findUnique({ where: { id }, include: includeCheckout });
    if (!checkout || key.length < 16 || checkout.idempotencyKey !== key) throw AppError.notFound("Membership checkout was not found.");
    if (checkout.membershipId) return this.confirmation(checkout);
    if (!checkout.payment.providerPaymentId) throw AppError.notFound("Membership checkout was not found.");
    const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: checkout.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: checkout.payment.providerPaymentId });
    if (intent.status !== "SUCCEEDED") throw AppError.paymentRequired(intent.failureMessage ?? "Payment has not completed.");
    if (intent.amountCents !== checkout.amountCents || intent.currency.toLowerCase() !== checkout.currency.toLowerCase() || intent.metadata.membershipCheckoutId !== checkout.id) throw AppError.conflict("Payment verification failed and requires manual review.");
    const settled = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "membership_checkouts" WHERE "id" = ${checkout.id} FOR UPDATE`);
      const locked = await tx.membershipCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      if (locked.membershipId) return tx.membershipCheckout.findUniqueOrThrow({ where: { id: checkout.id }, include: includeCheckout });
      const customer = await tx.customer.upsert({ where: { email: checkout.memberEmail }, create: { email: checkout.memberEmail, name: checkout.memberName, isGuest: true }, update: { name: checkout.memberName } });
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "memberships" WHERE "organizationId" = ${checkout.organizationId} AND "customerId" = ${customer.id} FOR UPDATE`);
      const prior = await tx.membership.findUnique({ where: { organizationId_customerId: { organizationId: checkout.organizationId, customerId: customer.id } } });
      if (prior?.status === "SUSPENDED") throw AppError.conflict("This membership was suspended after checkout began. Contact the cinema; the payment requires review.");
      const nextExpiration = membershipExpiration(checkout.durationMonths, prior?.expiresAt);
      const membership = prior
        ? await tx.membership.update({ where: { id: prior.id }, data: { planId: checkout.planId, tier: checkout.planName, status: "ACTIVE", expiresAt: nextExpiration } })
        : await tx.membership.create({ data: { organizationId: checkout.organizationId, customerId: customer.id, planId: checkout.planId, membershipNumber: `MEM-${randomBytes(6).toString("hex").toUpperCase()}`, tier: checkout.planName, status: "ACTIVE", expiresAt: nextExpiration } });
      await tx.payment.update({ where: { id: checkout.paymentId }, data: { status: "SUCCEEDED" } });
      await tx.membershipCheckout.update({ where: { id: checkout.id }, data: { membershipId: membership.id, status: "PAID" } });
      await tx.auditEvent.create({ data: { actorType: "SYSTEM", locationId: checkout.locationId, action: prior ? "membership.online_renewed" : "membership.online_issued", entityType: "Membership", entityId: membership.id, beforeState: prior ? { planId: prior.planId, tier: prior.tier, status: prior.status, expiresAt: prior.expiresAt } : undefined, afterState: { checkoutId: checkout.id, planId: checkout.planId, amountCents: checkout.amountCents, expiresAt: membership.expiresAt } } });
      return tx.membershipCheckout.findUniqueOrThrow({ where: { id: checkout.id }, include: includeCheckout });
    });
    await this.sendReceipt(settled); return this.confirmation(settled);
  }

  async processVerifiedWebhook(event: VerifiedProviderEvent) {
    if (!event.paymentIntentId || !event.metadata?.membershipCheckoutId) return { ignored: true };
    const checkout = await prisma.membershipCheckout.findUnique({ where: { id: event.metadata.membershipCheckoutId } });
    if (!checkout) throw AppError.notFound("Membership checkout was not found.");
    if (event.type === "payment_intent.succeeded") await this.finalize(checkout.id, checkout.idempotencyKey);
    else if (event.type === "payment_intent.payment_failed") await prisma.membershipCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED", payment: { update: { status: "FAILED" } } } });
    return { processed: true };
  }

  private async sendReceipt(checkout: Checkout) {
    if (checkout.receiptSentAt || !checkout.membership) return;
    try { const sent = await this.email.sendMembershipReceipt({ to: checkout.memberEmail, memberName: checkout.memberName, organizationName: checkout.location.organization.name, planName: checkout.planName, membershipNumber: checkout.membership.membershipNumber, expiresAt: checkout.membership.expiresAt, amountCents: checkout.amountCents, taxDeductibleAmountCents: checkout.taxDeductibleAmountCents, currency: checkout.currency }); await prisma.membershipCheckout.update({ where: { id: checkout.id }, data: { receiptMessageId: sent.messageId, receiptSentAt: new Date(), receiptError: null } }); }
    catch (error) { await prisma.membershipCheckout.update({ where: { id: checkout.id }, data: { receiptError: error instanceof Error ? error.message : "Receipt delivery failed." } }); }
  }
  private assertReplay(checkout: Checkout, input: Input) { if (checkout.locationId !== input.locationId || checkout.planId !== input.planId || checkout.memberName !== input.memberName || checkout.memberEmail !== input.memberEmail.toLowerCase()) throw AppError.conflict("The membership idempotency key was already used with different details."); }
  private present(checkout: Checkout, clientSecret?: string, providerStatus?: string) { return { checkoutId: checkout.id, status: checkout.status, planName: checkout.planName, amountCents: checkout.amountCents, currency: checkout.currency, memberName: checkout.memberName, memberEmail: checkout.memberEmail, payment: { status: providerStatus ?? checkout.payment.status, clientSecret } }; }
  private confirmation(checkout: Checkout) { return { checkoutId: checkout.id, membershipId: checkout.membershipId, membershipNumber: checkout.membership?.membershipNumber, expiresAt: checkout.membership?.expiresAt, status: checkout.status, planName: checkout.planName, amountCents: checkout.amountCents, currency: checkout.currency }; }
}

const includeCheckout = { payment: true, membership: true, location: { include: { organization: true } } } as const;
type Checkout = Prisma.MembershipCheckoutGetPayload<{ include: typeof includeCheckout }>;
type Input = { idempotencyKey: string; locationId: string; planId: string; memberName: string; memberEmail: string };
