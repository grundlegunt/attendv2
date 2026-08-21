import { Inject, Injectable } from "@nestjs/common";
import { PaymentAttemptStatus, PaymentPurpose, PaymentStatus, Prisma, prisma } from "@cinema/database";
import type { PaymentProvider } from "@cinema/payments";
import { createHash, randomBytes } from "node:crypto";
import { decryptMfaSecret, encryptMfaSecret } from "@cinema/auth";
import type { EmailProvider } from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";

function localPaymentStatus(status: string) {
  return status === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : status === "PROCESSING" ? PaymentStatus.PROCESSING : status === "REQUIRES_ACTION" ? PaymentStatus.REQUIRES_ACTION : status === "FAILED" ? PaymentStatus.FAILED : PaymentStatus.REQUIRES_PAYMENT_METHOD;
}

function localAttemptStatus(status: string) {
  return status === "SUCCEEDED" ? PaymentAttemptStatus.SUCCEEDED : status === "PROCESSING" ? PaymentAttemptStatus.PROCESSING : status === "REQUIRES_ACTION" ? PaymentAttemptStatus.REQUIRES_ACTION : status === "FAILED" ? PaymentAttemptStatus.FAILED : PaymentAttemptStatus.CREATED;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

@Injectable()
export class GiftCardPurchaseService {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider, @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {}

  async config(locationId?: string) {
    const location = locationId ? await prisma.location.findFirst({ where: { id: locationId, active: true, organization: { active: true } }, include: { organization: true } }) : await prisma.location.findFirst({ where: { active: true, organization: { active: true } }, orderBy: { createdAt: "asc" }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    const env = loadEnv();
    return { locationId: location.id, currency: location.currency, payment: { ready: Boolean(env.PAYMENT_PROVIDER === "stripe" && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_SECRET_KEY && location.organization.stripeConnectedAccountId), publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null, connectedAccountId: location.organization.stripeConnectedAccountId } };
  }

  async create(input: { idempotencyKey: string; locationId: string; amountCents: number; buyerEmail: string; recipientName?: string; recipientEmail: string; message?: string }) {
    if (input.idempotencyKey.length < 16) throw AppError.validationFailed("A valid purchase idempotency key is required.");
    const existing = await prisma.giftCardPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payment: true, location: { include: { organization: true } } } });
    if (existing) {
      this.assertReplayMatches(existing, input);
      return this.complete(existing);
    }
    const location = await prisma.location.findFirst({ where: { id: input.locationId, active: true, organization: { active: true } }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    let purchase: Awaited<ReturnType<typeof this.purchaseWithPayment>>;
    try {
      purchase = await prisma.giftCardPurchase.create({
        data: {
          organization: { connect: { id: location.organizationId } }, location: { connect: { id: location.id } }, amountCents: input.amountCents, currency: location.currency,
          buyerEmail: input.buyerEmail.toLowerCase(), recipientName: input.recipientName, recipientEmail: input.recipientEmail.toLowerCase(), message: input.message,
          idempotencyKey: input.idempotencyKey,
          payment: { create: { purpose: PaymentPurpose.GIFT_CARD_PURCHASE, amountCents: input.amountCents, currency: location.currency, status: PaymentStatus.CREATED, idempotencyKey: `gift-card-purchase:${input.idempotencyKey}`, provider: this.provider.name } },
        },
        include: { payment: true, location: { include: { organization: true } } },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      purchase = await this.waitForPurchase(input.idempotencyKey);
      this.assertReplayMatches(purchase, input);
    }
    return this.complete(purchase);
  }

  private assertReplayMatches(purchase: Awaited<ReturnType<typeof this.purchaseWithPayment>>, input: { locationId: string; amountCents: number; buyerEmail: string; recipientName?: string; recipientEmail: string; message?: string }) {
    const matches = purchase.locationId === input.locationId
      && purchase.amountCents === input.amountCents
      && purchase.buyerEmail === input.buyerEmail.toLowerCase()
      && purchase.recipientName === (input.recipientName ?? null)
      && purchase.recipientEmail === input.recipientEmail.toLowerCase()
      && purchase.message === (input.message ?? null);
    if (!matches) throw AppError.conflict("The gift card purchase idempotency key was already used with different purchase details.");
  }

  private async complete(purchase: Awaited<ReturnType<typeof this.purchaseWithPayment>>) {
    if (purchase.payment.providerPaymentId) {
      const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: purchase.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: purchase.payment.providerPaymentId });
      return this.present(purchase, intent.clientSecret);
    }
    const intent = await this.provider.createPaymentIntent({
      connectedAccountId: purchase.location.organization.stripeConnectedAccountId ?? undefined, amountCents: purchase.amountCents, currency: purchase.currency,
      metadata: { giftCardPurchaseId: purchase.id, organizationId: purchase.organizationId, locationId: purchase.locationId }, idempotencyKey: purchase.payment.idempotencyKey,
    });
    let updated: Awaited<ReturnType<typeof this.purchaseWithPayment>>;
    try {
      updated = await prisma.giftCardPurchase.update({ where: { id: purchase.id }, data: { payment: { update: { providerPaymentId: intent.id, status: localPaymentStatus(intent.status), attempts: { create: { provider: this.provider.name, providerIntentId: intent.id, attemptNumber: 1, status: localAttemptStatus(intent.status) } } } } }, include: { payment: true, location: { include: { organization: true } } } });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      updated = await this.waitForCompletedPurchase(purchase.id);
    }
    return this.present(updated, intent.clientSecret);
  }

  private async waitForPurchase(idempotencyKey: string) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const purchase = await prisma.giftCardPurchase.findUnique({ where: { idempotencyKey }, include: { payment: true, location: { include: { organization: true } } } });
      if (purchase) return purchase;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
    throw AppError.conflict("The gift card purchase is still being created. Please retry.");
  }

  private async waitForCompletedPurchase(id: string) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const purchase = await this.purchaseWithPayment(id);
      if (purchase.payment.providerPaymentId) return purchase;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
    throw AppError.conflict("The gift card payment is still being created. Please retry.");
  }

  private purchaseWithPayment(id: string) {
    return prisma.giftCardPurchase.findUniqueOrThrow({ where: { id }, include: { payment: true, location: { include: { organization: true } } } });
  }

  async finalize(purchaseId: string, purchaseKey: string) {
    const purchase = await this.purchaseWithPayment(purchaseId);
    this.assertPurchaseAccess(purchase.idempotencyKey, purchaseKey);
    if (!purchase.payment.providerPaymentId) throw AppError.notFound("Gift card purchase was not found.");
    const intent = await this.provider.retrievePaymentIntent({ connectedAccountId: purchase.location.organization.stripeConnectedAccountId ?? undefined, paymentIntentId: purchase.payment.providerPaymentId });
    if (intent.status !== "SUCCEEDED") throw AppError.paymentRequired(intent.failureMessage ?? "Payment has not completed.");
    if (intent.amountCents !== purchase.amountCents || intent.currency.toLowerCase() !== purchase.currency.toLowerCase() || intent.metadata.giftCardPurchaseId !== purchase.id) throw AppError.conflict("Payment verification failed and requires manual review.");
    const raw = randomBytes(12).toString("hex").toUpperCase();
    const code = `ATGC-${raw.match(/.{1,4}/g)!.join("-")}`;
    const codeHash = createHash("sha256").update(code.replace(/[^A-Z0-9]/g, "")).digest("hex");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "gift_card_purchases" WHERE "id" = ${purchase.id} FOR UPDATE`);
      const locked = await tx.giftCardPurchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { giftCard: true } });
      if (locked.giftCard) return { giftCard: locked.giftCard, created: false };
      const giftCard = await tx.giftCard.create({ data: { organizationId: purchase.organizationId, issuedAtLocationId: purchase.locationId, codeHash, codeLast4: raw.slice(-4), initialBalanceCents: purchase.amountCents, balanceCents: purchase.amountCents, currency: purchase.currency, recipientName: purchase.recipientName, recipientEmail: purchase.recipientEmail, transactions: { create: { locationId: purchase.locationId, type: "ISSUANCE", amountCents: purchase.amountCents, balanceAfterCents: purchase.amountCents, reference: purchase.id } } } });
      await tx.giftCardPurchase.update({ where: { id: purchase.id }, data: { giftCardId: giftCard.id, status: "PAID", deliveryCodeEncrypted: encryptMfaSecret(code, loadEnv().JWT_REFRESH_SECRET) } });
      await tx.payment.update({ where: { id: purchase.paymentId }, data: { status: "SUCCEEDED" } });
      await tx.auditEvent.create({ data: { actorType: "SYSTEM", locationId: purchase.locationId, action: "gift_card.online_purchase_paid", entityType: "GiftCardPurchase", entityId: purchase.id, afterState: { giftCardId: giftCard.id, amountCents: purchase.amountCents, recipientEmail: purchase.recipientEmail } } });
      return { giftCard, created: true };
    });
    const delivery = await this.deliver(purchase.id);
    return { purchaseId: purchase.id, status: "PAID", amountCents: purchase.amountCents, currency: purchase.currency, codeLast4: result.giftCard.codeLast4, code: result.created ? code : null, delivery };
  }

  async deliver(purchaseId: string) {
    const now = new Date();
    const claim = await prisma.giftCardPurchase.updateMany({ where: { id: purchaseId, giftCardId: { not: null }, deliveredAt: null, deliveryCodeEncrypted: { not: null }, OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: new Date(now.getTime() - 60_000) } }] }, data: { deliveryClaimedAt: now } });
    if (claim.count === 0) {
      const current = await prisma.giftCardPurchase.findUnique({ where: { id: purchaseId }, select: { status: true, deliveredAt: true } });
      if (!current) throw AppError.notFound("Gift card purchase was not found.");
      return { status: current.deliveredAt ? "DELIVERED" : current.status };
    }
    const purchase = await prisma.giftCardPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { organization: true } });
    try {
      const code = decryptMfaSecret(purchase.deliveryCodeEncrypted!, loadEnv().JWT_REFRESH_SECRET);
      const sent = await this.email.sendGiftCardDelivery({ to: purchase.recipientEmail, recipientName: purchase.recipientName, buyerEmail: purchase.buyerEmail, theaterName: purchase.organization.name, amountCents: purchase.amountCents, currency: purchase.currency, code, message: purchase.message });
      await prisma.giftCardPurchase.update({ where: { id: purchase.id }, data: { status: "DELIVERED", deliveryMessageId: sent.messageId, deliveredAt: new Date(), deliveryCodeEncrypted: null, deliveryClaimedAt: null, deliveryError: null } });
      return { status: "DELIVERED", messageId: sent.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown delivery error";
      await prisma.$transaction([prisma.giftCardPurchase.update({ where: { id: purchase.id }, data: { status: "DELIVERY_FAILED", deliveryClaimedAt: null, deliveryError: message } }), prisma.auditEvent.create({ data: { actorType: "SYSTEM", locationId: purchase.locationId, action: "gift_card.delivery_failed", entityType: "GiftCardPurchase", entityId: purchase.id, afterState: { recipientEmail: purchase.recipientEmail, error: message } } })]);
      return { status: "DELIVERY_FAILED" };
    }
  }

  async deliverAuthorized(purchaseId: string, purchaseKey: string) {
    const purchase = await prisma.giftCardPurchase.findUnique({
      where: { id: purchaseId },
      select: { idempotencyKey: true },
    });
    if (!purchase) throw AppError.notFound("Gift card purchase was not found.");
    this.assertPurchaseAccess(purchase.idempotencyKey, purchaseKey);
    return this.deliver(purchaseId);
  }

  private assertPurchaseAccess(expectedKey: string, purchaseKey: string) {
    if (purchaseKey.length < 16 || expectedKey !== purchaseKey) {
      throw AppError.notFound("Gift card purchase was not found.");
    }
  }

  private present(purchase: Awaited<ReturnType<typeof this.purchaseWithPayment>>, clientSecret?: string) {
    return { purchaseId: purchase.id, status: purchase.status, amountCents: purchase.amountCents, currency: purchase.currency, recipientEmail: purchase.recipientEmail, payment: { providerPaymentId: purchase.payment.providerPaymentId, status: purchase.payment.status, clientSecret } };
  }
}
