import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

@Module({
  imports: [AuditModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAuthGuard, RequestRateLimitGuard],
})
export class PlatformModule {}
