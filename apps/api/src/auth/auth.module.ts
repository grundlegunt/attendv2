import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuditModule } from "../audit/audit.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, RequestRateLimitGuard],
})
export class AuthModule {}
