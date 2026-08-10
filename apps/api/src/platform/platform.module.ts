import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { ConnectOnboardingModule } from "./connect-onboarding.module";
import { ReportingModule } from "../reporting/reporting.module";

@Module({
  imports: [AuditModule, ConnectOnboardingModule, ReportingModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAuthGuard, RequestRateLimitGuard],
})
export class PlatformModule {}
