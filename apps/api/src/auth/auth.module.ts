import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuditModule } from "../audit/audit.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { CustomerAuthEmailReconciliationService } from "./customer-auth-email-reconciliation.service";

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, CustomerAuthEmailReconciliationService, RequestRateLimitGuard],
})
export class AuthModule {}
