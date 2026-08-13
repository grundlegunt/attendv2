import { Inject, Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@cinema/database";
import { loadEnv } from "@cinema/config/env";
import {
  PaymentProvider,
  ProviderPaymentIntentResult,
} from "@cinema/payments";
import { PAYMENT_PROVIDER } from "../payments/payments.module";
import { AppError } from "../common/app-error";

type TenderInput = {
  type: "SAVED_METHOD" | "CARD_PRESENT";
  amountCents: number;
  paymentMethodReferenceId?: string;
  readerId?: string;
};

type Actor = {
  actorType: "EMPLOYEE" | "CUSTOMER" | "SYSTEM";
  actorId: string | null;
};

@Injectable()
export class RestaurantSettlementService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async staffTab(tabId: string, locationId: string) {
    return this.tabView({ tabId, locationId });
  }

  async issueGuestAccess(tabId: string, locationId: string) {
    const tab = await prisma.restaurantTab.findFirst({
      where: { id: tabId, locationId, primaryCustomerId: { not: null } },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    const payload = Buffer.from(
      JSON.stringify({
        tabId: tab.id,
        customerId: tab.primaryCustomerId,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }),
    ).toString("base64url");
    return {
      token: `${payload}.${this.signGuestPayload(payload)}`,
      expiresInSeconds: 86_400,
    };
  }

  async guestTab(token: string) {
    const grant = this.verifyGuestToken(token);
    return this.tabView({ tabId: grant.tabId, customerId: grant.customerId });
  }

  async selectGuestTip(token: string, tipCents: number) {
    const grant = this.verifyGuestToken(token);
    return this.selectTip(grant.tabId, grant.customerId, tipCents);
  }

  async payGuest(input: {
    token: string;
    requestId: string;
    tipCents: number;
    paymentMethodReferenceId: string;
  }) {
    const grant = this.verifyGuestToken(input.token);
    return this.payCustomer({
      tabId: grant.tabId,
      customerId: grant.customerId,
      requestId: input.requestId,
      tipCents: input.tipCents,
      paymentMethodReferenceId: input.paymentMethodReferenceId,
    });
  }

  async customerTab(tabId: string, customerId: string) {
    return this.tabView({ tabId, customerId });
  }

  async selectTip(tabId: string, customerId: string, tipCents: number) {
    const tab = await prisma.restaurantTab.findFirst({
      where: {
        id: tabId,
        primaryCustomerId: customerId,
        status: { in: ["PREAUTHORIZED", "OPEN", "READY_TO_CLOSE", "PAYMENT_FAILED"] },
      },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    await prisma.$transaction([
      prisma.restaurantTab.update({
        where: { id: tab.id },
        data: { selectedTipCents: tipCents },
      }),
      prisma.auditEvent.create({
        data: {
          actorType: "CUSTOMER",
          actorId: customerId,
          action: "restaurant_tab.tip_selected",
          entityType: "RestaurantTab",
          entityId: tab.id,
          locationId: tab.locationId,
          afterState: { tipCents },
        },
      }),
    ]);
    return this.tabView({ tabId: tab.id, customerId });
  }

  async checksDue(locationId: string, now = new Date()) {
    const tabs = await prisma.restaurantTab.findMany({
      where: {
        locationId,
        tabType: "SEAT_LINKED",
        checkDroppedAt: null,
        status: { in: ["PREAUTHORIZED", "OPEN"] },
        showtime: { isNot: null },
      },
      include: {
        showtime: { include: { movie: true, auditorium: true } },
        seats: { include: { showtimeSeat: { include: { seat: true } } } },
        location: true,
      },
      orderBy: { showtime: { endsAt: "asc" } },
    });
    return tabs
      .filter((tab) => {
        const dueAt =
          tab.showtime!.endsAt.getTime() -
          tab.location.checkDropMinutesBeforeEnd * 60_000;
        return dueAt <= now.getTime();
      })
      .map((tab) => ({
        id: tab.id,
        status: tab.status,
        movie: tab.showtime!.movie.title,
        auditorium: tab.showtime!.auditorium.name,
        endsAt: tab.showtime!.endsAt.toISOString(),
        seats: tab.seats.map((seat) => seat.showtimeSeat.seat.label),
      }));
  }

  async dropCheck(input: {
    tabId: string;
    locationId: string;
    employeeId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${input.tabId} FOR UPDATE`;
      const tab = await tx.restaurantTab.findFirst({
        where: {
          id: input.tabId,
          locationId: input.locationId,
          status: { in: ["PREAUTHORIZED", "OPEN", "READY_TO_CLOSE"] },
        },
      });
      if (!tab) throw AppError.notFound("Open restaurant tab was not found.");
      if (tab.checkDroppedAt) return tab;
      const droppedAt = new Date();
      const updated = await tx.restaurantTab.update({
        where: { id: tab.id },
        data: {
          status: "READY_TO_CLOSE",
          checkDroppedAt: droppedAt,
          checkDroppedByEmployeeId: input.employeeId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.employeeId,
          action: "restaurant_tab.check_dropped",
          entityType: "RestaurantTab",
          entityId: tab.id,
          locationId: tab.locationId,
          beforeState: { status: tab.status, checkDroppedAt: null },
          afterState: {
            status: updated.status,
            checkDroppedAt: droppedAt.toISOString(),
          },
        },
      });
      return updated;
    });
  }

  async finalizeStaff(input: {
    tabId: string;
    locationId: string;
    employeeId: string;
    requestId: string;
    tipCents: number;
    tenders: TenderInput[];
  }) {
    const tab = await prisma.restaurantTab.findFirst({
      where: { id: input.tabId, locationId: input.locationId },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    if (!tab.checkDroppedAt) {
      throw AppError.conflict("Drop the check before staff settlement.");
    }
    return this.settle({
      tabId: tab.id,
      requestKey: `staff:${input.requestId}`,
      tipCents: input.tipCents,
      tenders: input.tenders,
      actor: { actorType: "EMPLOYEE", actorId: input.employeeId },
    });
  }

  async payCustomer(input: {
    tabId: string;
    customerId: string;
    requestId: string;
    tipCents: number;
    paymentMethodReferenceId: string;
  }) {
    const tab = await prisma.restaurantTab.findFirst({
      where: {
        id: input.tabId,
        primaryCustomerId: input.customerId,
      },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    if (["SETTLEMENT_PENDING", "CLOSED"].includes(tab.status)) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: `customer:${input.requestId}:0` },
      });
      if (
        existing?.restaurantTabId === tab.id &&
        existing.tipCents === input.tipCents &&
        existing.paymentMethodReferenceId === input.paymentMethodReferenceId
      ) {
        return this.tabView({ tabId: tab.id, customerId: input.customerId });
      }
    }
    if (
      !["PREAUTHORIZED", "OPEN", "READY_TO_CLOSE", "PAYMENT_FAILED"].includes(
        tab.status,
      )
    ) {
      throw AppError.conflict("This restaurant tab cannot accept a payment.");
    }
    const totals = await this.calculateTotals(tab.id, input.tipCents);
    const alreadyPaid = await this.succeededPayments(tab.id);
    const remaining = totals.totalCents - alreadyPaid;
    if (remaining <= 0) {
      await this.closeIfPaid(tab.id, {
        actorType: "CUSTOMER",
        actorId: input.customerId,
      });
    } else {
      await this.settle({
        tabId: tab.id,
        requestKey: `customer:${input.requestId}`,
        tipCents: input.tipCents,
        tenders: [
          {
            type: "SAVED_METHOD",
            amountCents: remaining,
            paymentMethodReferenceId: input.paymentMethodReferenceId,
          },
        ],
        actor: { actorType: "CUSTOMER", actorId: input.customerId },
      });
    }
    return this.tabView({ tabId: tab.id, customerId: input.customerId });
  }

  async runFallback(now = new Date()) {
    const candidates = await prisma.restaurantTab.findMany({
      where: {
        tabType: "SEAT_LINKED",
        checkDroppedAt: null,
        status: { in: ["PREAUTHORIZED", "OPEN"] },
        autoSettleAuthorized: true,
        activePaymentMethodId: { not: null },
        showtime: { isNot: null },
      },
      include: { showtime: true, location: true },
    });
    const results = [];
    for (const tab of candidates) {
      const dueAt =
        tab.showtime!.endsAt.getTime() +
        tab.location.autoSettleGraceMinutes * 60_000;
      if (dueAt > now.getTime()) continue;
      const tipCents =
        tab.selectedTipCents ??
        Math.round(
          (await this.calculateTotals(tab.id, 0)).subtotalCents *
            (tab.location.autoSettleTipBasisPoints / 10_000),
        );
      results.push(
        await this.settle({
          tabId: tab.id,
          requestKey: `fallback:${tab.id}:${tab.showtime!.endsAt.toISOString()}`,
          tipCents,
          tenders: [
            {
              type: "SAVED_METHOD",
              amountCents: 0,
              paymentMethodReferenceId: tab.activePaymentMethodId!,
            },
          ],
          actor: { actorType: "SYSTEM", actorId: null },
          fillRemainingTender: true,
        }),
      );
    }
    return results;
  }

  async reconcileProcessingPayments() {
    const payments = await prisma.payment.findMany({
      where: {
        purpose: "RESTAURANT_TAB",
        status: "PROCESSING",
        providerPaymentId: { not: null },
        restaurantTabId: { not: null },
      },
      include: {
        restaurantTab: {
          include: { location: { include: { organization: true } } },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    let resolved = 0;
    let pending = 0;
    let errors = 0;
    for (const payment of payments) {
      try {
        const result = await this.provider.retrievePaymentIntent({
          connectedAccountId:
            payment.restaurantTab!.location.organization.stripeConnectedAccountId ??
            undefined,
          paymentIntentId: payment.providerPaymentId!,
        });
        if (result.status === "PROCESSING") {
          pending += 1;
          continue;
        }
        await this.recordProviderResult(payment.id, result);
        await this.closeIfPaid(payment.restaurantTabId!, {
          actorType: "SYSTEM",
          actorId: null,
        });
        resolved += 1;
      } catch {
        errors += 1;
      }
    }
    return { checked: payments.length, resolved, pending, errors };
  }

  private async settle(input: {
    tabId: string;
    requestKey: string;
    tipCents: number;
    tenders: TenderInput[];
    actor: Actor;
    fillRemainingTender?: boolean;
  }) {
    const reservation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${input.tabId} FOR UPDATE`;
      const tab = await tx.restaurantTab.findUnique({
        where: { id: input.tabId },
        include: {
          location: { include: { organization: true } },
          orders: { select: { status: true } },
        },
      });
      if (!tab) throw AppError.notFound("Restaurant tab was not found.");
      if (tab.status === "CLOSED") return { tab, payments: [], alreadyClosed: true };
      if (tab.orders.some((order) => order.status === "DRAFT")) {
        throw AppError.conflict("Send or remove every draft order before settlement.");
      }
      const totals = await this.calculateTotals(tab.id, input.tipCents, tx);
      const paid = await tx.payment.aggregate({
        where: {
          restaurantTabId: tab.id,
          status: "SUCCEEDED",
        },
        _sum: { amountCents: true },
      });
      const remaining = totals.totalCents - (paid._sum.amountCents ?? 0);
      if (remaining <= 0) return { tab, payments: [], totals, alreadyClosed: false };
      const tenders = input.tenders.map((tender, index) =>
        input.fillRemainingTender && index === 0
          ? { ...tender, amountCents: remaining }
          : tender,
      );
      if (
        tenders.reduce((sum, tender) => sum + tender.amountCents, 0) !== remaining
      ) {
        throw AppError.validationFailed(
          `Tender amounts must total the remaining balance of ${remaining} cents.`,
        );
      }
      const payments = [];
      for (const [index, tender] of tenders.entries()) {
        const idempotencyKey = `${input.requestKey}:${index}`;
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          if (
            existing.restaurantTabId !== tab.id ||
            existing.amountCents !== tender.amountCents
          ) {
            throw AppError.conflict("Settlement request id was reused with different details.");
          }
          payments.push({ payment: existing, tender });
          continue;
        }
        const paymentMethod =
          tender.type === "SAVED_METHOD" && tab.primaryCustomerId
            ? await tx.paymentMethodReference.findFirst({
                where: {
                  id: tender.paymentMethodReferenceId,
                  active: true,
                  paymentCustomer: {
                    customerId: tab.primaryCustomerId,
                  },
                },
                include: { paymentCustomer: true },
              })
            : null;
        if (tender.type === "SAVED_METHOD" && !paymentMethod) {
          throw AppError.notFound("Saved payment method was not found.");
        }
        const payment = await tx.payment.create({
          data: {
            purpose: "RESTAURANT_TAB",
            restaurantTabId: tab.id,
            amountCents: tender.amountCents,
            tipCents: index === 0 ? input.tipCents : 0,
            currency: tab.location.currency,
            status: "CREATED",
            paymentMethodReferenceId: paymentMethod?.id,
            idempotencyKey,
            provider: this.provider.name,
          },
        });
        payments.push({ payment, tender, paymentMethod });
      }
      await tx.restaurantTab.update({
        where: { id: tab.id },
        data: {
          status: "SETTLEMENT_PENDING",
          selectedTipCents: input.tipCents,
          ...totals,
        },
      });
      return {
        tab,
        totals,
        payments,
        alreadyClosed: false,
      };
    });

    if (reservation.alreadyClosed) return this.tabView({ tabId: input.tabId });
    for (const reserved of reservation.payments) {
      if (reserved.payment.status !== "CREATED") continue;
      let result: ProviderPaymentIntentResult;
      try {
        result =
          reserved.tender.type === "SAVED_METHOD"
            ? await this.provider.chargeSavedPaymentMethod({
                connectedAccountId:
                  reservation.tab.location.organization.stripeConnectedAccountId ??
                  undefined,
                providerCustomerId: reserved.paymentMethod!.paymentCustomer.providerCustomerId,
                providerPaymentMethodId:
                  reserved.paymentMethod!.providerPaymentMethodId,
                amountCents: reserved.payment.amountCents,
                currency: reserved.payment.currency,
                metadata: {
                  restaurantTabId: input.tabId,
                  paymentId: reserved.payment.id,
                },
                idempotencyKey: reserved.payment.idempotencyKey,
              })
            : await this.provider.collectCardPresentPayment({
                connectedAccountId:
                  reservation.tab.location.organization.stripeConnectedAccountId ??
                  undefined,
                readerId: reserved.tender.readerId!,
                amountCents: reserved.payment.amountCents,
                currency: reserved.payment.currency,
                metadata: {
                  restaurantTabId: input.tabId,
                  paymentId: reserved.payment.id,
                },
                idempotencyKey: reserved.payment.idempotencyKey,
              });
      } catch (error) {
        result = {
          id: `provider_error_${reserved.payment.id}`,
          status: "FAILED",
          amountCents: reserved.payment.amountCents,
          currency: reserved.payment.currency,
          metadata: { restaurantTabId: input.tabId },
          failureMessage:
            error instanceof Error ? error.message : "Payment provider failed.",
        };
      }
      await this.recordProviderResult(reserved.payment.id, result);
    }
    return this.closeIfPaid(input.tabId, input.actor);
  }

  private async recordProviderResult(
    paymentId: string,
    result: ProviderPaymentIntentResult,
  ) {
    const status =
      result.status === "SUCCEEDED"
        ? "SUCCEEDED"
        : result.status === "PROCESSING"
          ? "PROCESSING"
          : result.status === "CANCELED"
            ? "CANCELED"
            : "FAILED";
    await prisma.$transaction(async (tx) => {
      const attempts = await tx.paymentAttempt.count({ where: { paymentId } });
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status,
          providerPaymentId: result.id,
        },
      });
      await tx.paymentAttempt.create({
        data: {
          paymentId,
          provider: this.provider.name,
          providerIntentId: result.id,
          attemptNumber: attempts + 1,
          status:
            status === "SUCCEEDED"
              ? "SUCCEEDED"
              : status === "PROCESSING"
                ? "PROCESSING"
              : status === "CANCELED"
                ? "CANCELED"
                : "FAILED",
          failureCode: result.failureCode,
          failureMessage: result.failureMessage,
        },
      });
    });
  }

  private async closeIfPaid(tabId: string, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${tabId} FOR UPDATE`;
      const tab = await tx.restaurantTab.findUnique({
        where: { id: tabId },
        include: { payments: true, receipt: true },
      });
      if (!tab) throw AppError.notFound("Restaurant tab was not found.");
      if (tab.status === "CLOSED") return tab;
      const paid = tab.payments
        .filter((payment) => payment.status === "SUCCEEDED")
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      if (paid < (tab.totalCents ?? 0)) {
        const hasFailed = tab.payments.some((payment) => payment.status === "FAILED");
        await tx.restaurantTab.update({
          where: { id: tab.id },
          data: { status: hasFailed ? "PAYMENT_FAILED" : "SETTLEMENT_PENDING" },
        });
        if (hasFailed) {
          await tx.auditEvent.create({
            data: {
              actorType: actor.actorType,
              actorId: actor.actorId,
              action: "restaurant_tab.payment_failed",
              entityType: "RestaurantTab",
              entityId: tab.id,
              locationId: tab.locationId,
              afterState: {
                paidCents: paid,
                totalCents: tab.totalCents ?? 0,
              },
            },
          });
        }
        return tx.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } });
      }
      const closedAt = new Date();
      const updated = await tx.restaurantTab.update({
        where: { id: tab.id },
        data: { status: "CLOSED", closedAt },
      });
      if (!tab.receipt) {
        await tx.restaurantReceipt.create({
          data: {
            restaurantTabId: tab.id,
            receiptNumber: `R-${closedAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
            subtotalCents: tab.subtotalCents ?? 0,
            taxCents: tab.taxCents ?? 0,
            serviceChargeCents: tab.serviceChargeCents ?? 0,
            tipCents: tab.selectedTipCents ?? 0,
            totalCents: tab.totalCents ?? 0,
            tenderSummary: tab.payments
              .filter((payment) => payment.status === "SUCCEEDED")
              .map((payment) => ({
                amountCents: payment.amountCents,
                paymentMethodReferenceId: payment.paymentMethodReferenceId,
              })),
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: "restaurant_tab.closed",
          entityType: "RestaurantTab",
          entityId: tab.id,
          locationId: tab.locationId,
          beforeState: { status: tab.status },
          afterState: {
            status: "CLOSED",
            totalCents: tab.totalCents ?? 0,
            closedAt: closedAt.toISOString(),
          },
        },
      });
      return updated;
    });
  }

  private async tabView(input: {
    tabId: string;
    locationId?: string;
    customerId?: string;
  }) {
    const tab = await prisma.restaurantTab.findFirst({
      where: {
        id: input.tabId,
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.customerId ? { primaryCustomerId: input.customerId } : {}),
      },
      include: {
        activePaymentMethod: {
          select: { id: true, brand: true, last4: true, expMonth: true, expYear: true },
        },
        orders: {
          include: { items: { include: { menuItem: true } } },
          orderBy: { createdAt: "asc" },
        },
        payments: {
          select: {
            id: true,
            amountCents: true,
            status: true,
            paymentMethodReferenceId: true,
          },
        },
        receipt: true,
      },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    const totals = await this.calculateTotals(
      tab.id,
      tab.selectedTipCents ?? 0,
    );
    return {
      ...tab,
      totals,
      paidCents: tab.payments
        .filter((payment) => payment.status === "SUCCEEDED")
        .reduce((sum, payment) => sum + payment.amountCents, 0),
    };
  }

  private async succeededPayments(tabId: string) {
    const result = await prisma.payment.aggregate({
      where: { restaurantTabId: tabId, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  private async calculateTotals(
    tabId: string,
    tipCents: number,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const tab = await client.restaurantTab.findUnique({
      where: { id: tabId },
      include: {
        location: {
          include: {
            taxRules: { where: { active: true } },
            serviceChargeRules: { where: { active: true, autoApply: true } },
          },
        },
        orders: {
          where: { status: { notIn: ["DRAFT", "CANCELED"] } },
          include: {
            items: {
              where: { status: { notIn: ["VOIDED", "COMPED"] } },
              include: { menuItem: true },
            },
          },
        },
      },
    });
    if (!tab) throw AppError.notFound("Restaurant tab was not found.");
    const categoryTotals = new Map<string, number>([
      ["FOOD", 0],
      ["ALCOHOL", 0],
      ["NA_BEVERAGE", 0],
    ]);
    const items = tab.orders.flatMap((order) => order.items);
    for (const item of items) {
      const line =
        (item.unitPriceCentsSnapshot + item.modifierTotalCents) * item.quantity;
      categoryTotals.set(
        item.menuItem.chargeCategory,
        (categoryTotals.get(item.menuItem.chargeCategory) ?? 0) + line,
      );
    }
    const subtotalCents = [...categoryTotals.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const baseFor = (appliesTo: string) =>
      appliesTo === "ALL"
        ? subtotalCents
        : (categoryTotals.get(appliesTo) ?? 0);
    const taxCents = tab.location.taxRules.reduce(
      (sum, rule) =>
        sum + Math.round((baseFor(rule.appliesTo) * rule.ratePermille) / 1000),
      0,
    );
    const serviceChargeCents = tab.location.serviceChargeRules.reduce(
      (sum, rule) =>
        sum +
        (rule.flatCents ??
          Math.round((baseFor(rule.appliesTo) * (rule.ratePermille ?? 0)) / 1000)),
      0,
    );
    return {
      subtotalCents,
      taxCents,
      serviceChargeCents,
      totalCents: subtotalCents + taxCents + serviceChargeCents + tipCents,
    };
  }

  private signGuestPayload(payload: string) {
    return createHmac("sha256", loadEnv().QR_CREDENTIAL_SECRET)
      .update(`restaurant-tab:${payload}`)
      .digest("base64url");
  }

  private verifyGuestToken(token: string) {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
      throw AppError.unauthenticated("Restaurant tab link is invalid.");
    }
    const expected = this.signGuestPayload(payload);
    const givenBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      givenBytes.length !== expectedBytes.length ||
      !timingSafeEqual(givenBytes, expectedBytes)
    ) {
      throw AppError.unauthenticated("Restaurant tab link is invalid.");
    }
    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
        tabId: string;
        customerId: string;
        expiresAt: number;
      };
      if (
        !decoded.tabId ||
        !decoded.customerId ||
        decoded.expiresAt <= Date.now()
      ) {
        throw new Error("expired");
      }
      return decoded;
    } catch {
      throw AppError.unauthenticated("Restaurant tab link is invalid or expired.");
    }
  }
}
