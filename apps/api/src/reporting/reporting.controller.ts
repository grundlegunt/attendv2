import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Permission } from "@cinema/auth";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ReportingService } from "./reporting.service";

@Controller("reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.ReportsView)
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get("revenue")
  @RequirePermissions(Permission.ReportsViewFinancial)
  revenue(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reporting.revenue(this.location(actor), this.range(from, to));
  }

  @Get("revenue.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async revenueCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const report = await this.reporting.revenue(this.location(actor), this.range(from, to));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-revenue.csv"');
    response.send(this.reporting.revenueCsv(report));
  }

  @Get("labor")
  labor(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reporting.labor(this.location(actor), this.range(from, to));
  }

  @Get("labor.csv")
  async laborCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const report = await this.reporting.labor(this.location(actor), this.range(from, to));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-hours.csv"');
    response.send(this.reporting.laborCsv(report.rows));
  }

  private location(actor: RequestActor) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return actor.locationId;
  }

  private range(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw AppError.validationFailed("A valid from/to date range is required.");
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) throw AppError.validationFailed("Report ranges cannot exceed 366 days.");
    return { from: start, to: end };
  }
}
