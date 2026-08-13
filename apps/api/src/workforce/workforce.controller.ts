import { Body, Controller, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { shiftBreakEndRequestSchema, shiftBreakStartRequestSchema, shiftClockInRequestSchema, shiftClockOutRequestSchema, shiftManagerAdjustmentSchema, shiftPinRequestSchema } from "@cinema/shared";
import { Permission } from "@cinema/auth";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { WorkforceService } from "./workforce.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { WorkforceRateLimitGuard } from "./workforce-rate-limit.guard";

@Controller("shifts")
@UseGuards(WorkforceRateLimitGuard)
export class WorkforceController {
  constructor(private readonly workforce: WorkforceService) {}

  @Post("status") @HttpCode(200)
  status(@Body(new ZodValidationPipe(shiftPinRequestSchema)) body: unknown) {
    return this.workforce.status(shiftPinRequestSchema.parse(body));
  }
  @Post("clock-in")
  clockIn(@Body(new ZodValidationPipe(shiftClockInRequestSchema)) body: unknown) {
    return this.workforce.clockIn(shiftClockInRequestSchema.parse(body));
  }
  @Post("break/start")
  startBreak(@Body(new ZodValidationPipe(shiftBreakStartRequestSchema)) body: unknown) {
    return this.workforce.startBreak(shiftBreakStartRequestSchema.parse(body));
  }
  @Post("break/end")
  endBreak(@Body(new ZodValidationPipe(shiftBreakEndRequestSchema)) body: unknown) {
    return this.workforce.endBreak(shiftBreakEndRequestSchema.parse(body));
  }
  @Post("clock-out")
  clockOut(@Body(new ZodValidationPipe(shiftClockOutRequestSchema)) body: unknown) {
    return this.workforce.clockOut(shiftClockOutRequestSchema.parse(body));
  }
}

@Controller("shifts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkforceManagerController {
  constructor(private readonly workforce: WorkforceService) {}

  @Patch(":shiftId")
  @RequirePermissions(Permission.EmployeeEdit)
  adjust(@CurrentActor() actor: RequestActor, @Param("shiftId") shiftId: string, @Body(new ZodValidationPipe(shiftManagerAdjustmentSchema)) body: unknown) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return this.workforce.adjustShift({ ...shiftManagerAdjustmentSchema.parse(body), shiftId, locationId: actor.locationId, managerId: actor.sub });
  }
}
