import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { GiftCardPurchaseController } from "./gift-card-purchase.controller";
import { GiftCardPurchaseService } from "./gift-card-purchase.service";

@Module({ imports: [PaymentsModule, NotificationsModule], controllers: [GiftCardPurchaseController], providers: [GiftCardPurchaseService, RequestRateLimitGuard], exports: [GiftCardPurchaseService] })
export class GiftCardPurchaseModule {}
