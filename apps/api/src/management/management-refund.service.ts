import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import type { PaymentProvider, RefundResult } from "@cinema/payments";
import { BoxOfficeService } from "../box-office/box-office.service";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";

@Injectable()
export class ManagementRefundService {
  constructor(
    private readonly boxOffice: BoxOfficeService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async refundable(locationId: string, query?: string) {
    const normalized = query?.trim();
    const [ticketOrders, restaurantTabs] = await Promise.all([
      prisma.ticketOrder.findMany({
        where: { locationId, status: { in: ["PAID", "EXCHANGED"] }, ...(normalized ? { OR: [{ orderNumber: { contains: normalized, mode: "insensitive" } }, { guestEmail: { contains: normalized, mode: "insensitive" } }, { guestName: { contains: normalized, mode: "insensitive" } }] } : {}) },
        include: { tickets: { include: { showtimeSeat: { include: { seat: true, showtime: { include: { movie: true } } } } } }, payment: true, cashTransactions: true },
        orderBy: { createdAt: "desc" }, take: 50,
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, status: "CLOSED", payments: { some: { status: "SUCCEEDED" } }, ...(normalized ? { OR: [{ label: { contains: normalized, mode: "insensitive" } }, { primaryCustomer: { is: { OR: [{ email: { contains: normalized, mode: "insensitive" } }, { name: { contains: normalized, mode: "insensitive" } }] } } }] } : {}) },
        include: { primaryCustomer: { select: { name: true, email: true } }, showtime: { include: { movie: true } }, receipt: true, payments: { where: { status: "SUCCEEDED" } } },
        orderBy: { closedAt: "desc" }, take: 50,
      }),
    ]);
    return { ticketOrders, restaurantTabs };
  }

  refundTicket(input: { orderId: string; locationId: string; employeeId: string; requestId: string; reason: string; cashDrawerId?: string }) {
    return this.boxOffice.refundOrder(input);
  }

  async refundRestaurant(input: { tabId: string; locationId: string; employeeId: string; requestId: string; reason: string }) {
    const tab = await prisma.restaurantTab.findFirst({
      where: { id: input.tabId, locationId: input.locationId, status: "CLOSED" },
      include: { payments: { where: { status: "SUCCEEDED" }, include: { refunds: true } }, location: { include: { organization: true } } },
    });
    if (!tab) throw AppError.notFound("Refundable restaurant tab was not found.");
    if (!tab.payments.length) throw AppError.conflict("The restaurant tab has no refundable payments.");
    if (tab.payments.some((payment) => !payment.providerPaymentId)) throw AppError.conflict("A restaurant payment is missing its provider reference.");

    const results: Array<{ paymentId: string; refundId: string; result: RefundResult }> = [];
    for (const payment of tab.payments) {
      const idempotencyKey = `management-restaurant-refund:${input.requestId}:${payment.id}`;
      const refund = await prisma.refund.upsert({
        where: { idempotencyKey }, update: {},
        create: { paymentId: payment.id, amountCents: payment.amountCents, reason: input.reason, scope: "RESTAURANT", idempotencyKey },
      });
      if (refund.status === "SUCCEEDED") continue;
      try {
        const result = await this.provider.refund({
          connectedAccountId: tab.location.organization.stripeConnectedAccountId ?? undefined,
          providerPaymentId: payment.providerPaymentId!, amountCents: payment.amountCents,
          reason: "requested_by_customer", idempotencyKey,
          metadata: { refundId: refund.id, restaurantTabId: tab.id, paymentId: payment.id },
        });
        results.push({ paymentId: payment.id, refundId: refund.id, result });
      } catch (error) {
        await prisma.$transaction([
          prisma.restaurantTab.update({ where: { id: tab.id }, data: { status: "MANAGER_REVIEW" } }),
          prisma.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "restaurant_tab.refund_attention_required", entityType: "RestaurantTab", entityId: tab.id, afterState: { refundId: refund.id, paymentId: payment.id, status: "UNKNOWN", error: error instanceof Error ? error.message : "Unknown provider error" } } }),
        ]);
        throw AppError.conflict("The refund outcome is uncertain and requires manager review.");
      }
    }

    const terminalFailure = results.find(({ result }) => result.status === "FAILED");
    const pending = results.some(({ result }) => result.status === "PENDING");
    await prisma.$transaction(async (tx) => {
      for (const entry of results) {
        await tx.refund.update({ where: { id: entry.refundId }, data: { providerRefundId: entry.result.id, status: entry.result.status === "SUCCEEDED" ? "SUCCEEDED" : entry.result.status === "FAILED" ? "FAILED" : "PROCESSING" } });
        if (entry.result.status === "SUCCEEDED") await tx.payment.update({ where: { id: entry.paymentId }, data: { status: "REFUNDED" } });
      }
      const status = terminalFailure || pending ? "MANAGER_REVIEW" : "REFUNDED";
      await tx.restaurantTab.update({ where: { id: tab.id }, data: { status } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: status === "REFUNDED" ? "restaurant_tab.refunded" : "restaurant_tab.refund_attention_required", entityType: "RestaurantTab", entityId: tab.id, afterState: { reason: input.reason, paymentCount: tab.payments.length, status } } });
    });
    if (terminalFailure) throw AppError.conflict("A restaurant refund was rejected and requires manager review.");
    return prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id }, include: { payments: { include: { refunds: true } }, receipt: true } });
  }
}
