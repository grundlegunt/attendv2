import { Module } from "@nestjs/common";
import { WorkforceController, WorkforceManagerController } from "./workforce.controller";
import { WorkforceService } from "./workforce.service";

@Module({ controllers: [WorkforceController, WorkforceManagerController], providers: [WorkforceService] })
export class WorkforceModule {}
