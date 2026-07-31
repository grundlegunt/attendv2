import { Module } from "@nestjs/common";
import { WorkforceController, WorkforceManagerController } from "./workforce.controller";
import { WorkforceService } from "./workforce.service";
import { WorkforceRateLimitGuard } from "./workforce-rate-limit.guard";

@Module({ controllers: [WorkforceController, WorkforceManagerController], providers: [WorkforceService, WorkforceRateLimitGuard] })
export class WorkforceModule {}
