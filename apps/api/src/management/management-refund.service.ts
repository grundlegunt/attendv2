import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import type { PaymentProvider } from "@cinema/payments";
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
        include: {
          tickets: {
            include: {
              showtimeSeat: {
                include: { seat: true, showtime: { include: { movie: true } } },
              },
            },
          },
          payment: { include: { refunds: { orderBy: { createdAt: "desc" } } } },
          cashTransactions: true,
        },
        orderBy: { createdAt: "desc" }, take: 50,
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, status: { in: ["CLOSED", "MANAGER_REVIEW"] }, payments: { some: { status: { in: ["SUCCEEDED", "REFUNDED"] } } }, ...(normalized ? { OR: [{ label: { contains: normalized, mode: "insensitive" } }, { primaryCustomer: { is: { OR: [{ email: { contains: normalized, mode: "insensitive" } }, { name: { contains: normalized, mode: "insensitive" } }] } } }] } : {}) },
        include: { primaryCustomer: { select: { name: true, email: true } }, showtime: { include: { movie: true } }, receipt: true, payments: { where: { status: { in: ["SUCCEEDED", "REFUNDED"] } }, include: { refunds: true } } },
        orderBy: { closedAt: "desc" }, take: 50,
      }),
    ]);
    return { ticketOrders, restaurantTabs };
  }

  async history(locationId: string, input: { query?: string; from?: Date; to?: Date }) {
    const normalized = input.query?.trim();
    const createdAt = input.from || input.to ? { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } : undefined;
    const [ticketOrders, restaurantTabs] = await Promise.all([
      prisma.ticketOrder.findMany({
        where: { locationId, status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] }, ...(createdAt ? { updatedAt: createdAt } : {}), ...(normalized ? { OR: [{ orderNumber: { contains: normalized, mode: "insensitive" } }, { guestEmail: { contains: normalized, mode: "insensitive" } }, { guestName: { contains: normalized, mode: "insensitive" } }] } : {}) },
        include: {
          tickets: { include: { showtimeSeat: { include: { seat: true, showtime: { include: { movie: true } } } } } },
          payment: { include: { refunds: { orderBy: { createdAt: "desc" } } } },
          cashTransactions: { where: { type: "REFUND" }, orderBy: { createdAt: "desc" } },
        },
        orderBy: { updatedAt: "desc" }, take: 100,
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, status: "REFUNDED", ...(createdAt ? { updatedAt: createdAt } : {}), ...(normalized ? { OR: [{ label: { contains: normalized, mode: "insensitive" } }, { primaryCustomer: { is: { OR: [{ email: { contains: normalized, mode: "insensitive" } }, { name: { contains: normalized, mode: "insensitive" } }] } } }] } : {}) },
        include: { primaryCustomer: { select: { name: true, email: true } }, showtime: { include: { movie: true } }, receipt: true, payments: { include: { refunds: { orderBy: { createdAt: "desc" } } } } },
        orderBy: { updatedAt: "desc" }, take: 100,
      }),
    ]);
    return { ticketOrders, restaurantTabs };
  }

  refundTicket(input: { orderId: string; locationId: string; employeeId: string; requestId: string; reason: string; cashDrawerId?: string }) {
    return this.boxOffice.refundOrder(input);
  }

  async refundRestaurant(input: { tabId: string; locationId: string; employeeId: string; requestId: string; reason: string }) {
    const tab = await prisma.restaurantTab.findFirst({
      where: { id: input.tabId, locationId: input.locationId, status: { in: ["CLOSED", "MANAGER_REVIEW"] } },
      include: { payments: { where: { status: { in: ["SUCCEEDED", "REFUNDED"] } }, include: { refunds: { orderBy: { createdAt: "desc" } } } }, location: { include: { organization: true } } },
    });
    if (!tab) throw AppError.notFound("Refundable restaurant tab was not found.");
    if (!tab.payments.length) throw AppError.conflict("The restaurant tab has no refundable payments.");
    if (tab.payments.some((payment) => payment.status !== "REFUNDED" && !payment.providerPaymentId)) throw AppError.conflict("A restaurant payment is missing its provider reference.");

    let requiresAttention = false;
    for (const payment of tab.payments) {
      const succeeded = payment.refunds.find((refund) => refund.status === "SUCCEEDED");
      if (payment.status === "REFUNDED" || succeeded) {
        if (payment.status !== "REFUNDED") await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
        continue;
      }
      const unresolved = payment.refunds.find((refund) => refund.status === "CREATED" || refund.status === "PROCESSING");
      const baseKey = `management-restaurant-refund:${tab.id}:${payment.id}`;
      const idempotencyKey = unresolved?.idempotencyKey ?? (payment.refunds.some((refund) => refund.status === "FAILED") ? `${baseKey}:retry:${input.requestId}` : baseKey);
      const refund = await prisma.refund.upsert({
        where: { idempotencyKey }, update: {},
        create: { paymentId: payment.id, amountCents: payment.amountCents, reason: input.reason, scope: "RESTAURANT", idempotencyKey },
      });
      try {
        const connectedAccountId = tab.location.organization.stripeConnectedAccountId ?? undefined;
        const result = refund.status === "PROCESSING" && refund.providerRefundId
          ? await this.provider.retrieveRefund({ connectedAccountId, providerRefundId: refund.providerRefundId })
          : await this.provider.refund({
              connectedAccountId,
              providerPaymentId: payment.providerPaymentId!, amountCents: payment.amountCents,
              reason: "requested_by_customer", idempotencyKey,
              metadata: { refundId: refund.id, restaurantTabId: tab.id, paymentId: payment.id },
            });
        await prisma.$transaction([
          prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: result.id, status: result.status === "SUCCEEDED" ? "SUCCEEDED" : result.status === "FAILED" ? "FAILED" : "PROCESSING" } }),
          ...(result.status === "SUCCEEDED" ? [prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } })] : []),
        ]);
        if (result.status !== "SUCCEEDED") requiresAttention = true;
      } catch (error) {
        requiresAttention = true;
        await prisma.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "restaurant_tab.refund_attention_required", entityType: "RestaurantTab", entityId: tab.id, afterState: { refundId: refund.id, paymentId: payment.id, status: "UNKNOWN", error: error instanceof Error ? error.message : "Unknown provider error" } } });
      }
    }

    const paymentStates = await prisma.payment.findMany({ where: { id: { in: tab.payments.map((payment) => payment.id) } }, select: { status: true } });
    const status = !requiresAttention && paymentStates.every((payment) => payment.status === "REFUNDED") ? "REFUNDED" : "MANAGER_REVIEW";
    await prisma.$transaction(async (tx) => {
      await tx.restaurantTab.update({ where: { id: tab.id }, data: { status } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: status === "REFUNDED" ? "restaurant_tab.refunded" : "restaurant_tab.refund_attention_required", entityType: "RestaurantTab", entityId: tab.id, afterState: { reason: input.reason, paymentCount: tab.payments.length, status } } });
    });
    if (status === "MANAGER_REVIEW") throw AppError.conflict("One or more restaurant refunds require manager review; completed tenders were preserved and this tab can be retried.");
    return prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id }, include: { payments: { include: { refunds: true } }, receipt: true } });
  }
}
