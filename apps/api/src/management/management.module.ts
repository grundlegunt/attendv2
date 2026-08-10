import { Module } from "@nestjs/common";
import { ManagementController } from "./management.controller";
import { ManagementService } from "./management.service";
import { ManagementRefundService } from "./management-refund.service";
import { BoxOfficeModule } from "../box-office/box-office.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({ imports: [BoxOfficeModule, PaymentsModule], controllers: [ManagementController], providers: [ManagementService, ManagementRefundService] })
export class ManagementModule {}
