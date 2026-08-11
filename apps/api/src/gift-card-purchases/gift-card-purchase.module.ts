import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { GiftCardPurchaseController } from "./gift-card-purchase.controller";
import { GiftCardPurchaseService } from "./gift-card-purchase.service";

@Module({ imports: [PaymentsModule], controllers: [GiftCardPurchaseController], providers: [GiftCardPurchaseService, RequestRateLimitGuard] })
export class GiftCardPurchaseModule {}
