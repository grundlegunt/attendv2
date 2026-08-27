import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod/v3";
import { Permission } from "@cinema/auth";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ReportingService } from "./reporting.service";

const expenseCategorySchema = z.enum(["FILM_RENTAL", "FOOD_BEVERAGE", "PAYROLL", "OCCUPANCY", "MARKETING", "EQUIPMENT", "MAINTENANCE", "UTILITIES", "INSURANCE", "OTHER"]);
const expenseSchema = z.object({
  category: expenseCategorySchema,
  vendor: z.string().trim().max(160).optional(),
  description: z.string().trim().min(1).max(240),
  amountCents: z.number().int().positive().max(100_000_000),
  incurredAt: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

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

  @Get("movies/:movieId")
  @RequirePermissions(Permission.ReportsViewFinancial)
  moviePerformance(
    @CurrentActor() actor: RequestActor,
    @Param("movieId") movieId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const range = from || to ? this.range(from, to) : undefined;
    return this.reporting.moviePerformance(this.location(actor), movieId, range);
  }

  @Get("movies/:movieId/performance.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async moviePerformanceCsv(@CurrentActor() actor: RequestActor, @Param("movieId") movieId: string, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const range = from || to ? this.range(from, to) : undefined;
    const report = await this.reporting.moviePerformance(this.location(actor), movieId, range);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-film-performance.csv"');
    response.send(this.reporting.moviePerformanceCsv(report));
  }

  @Get("showtimes/:showtimeId/ticket-map")
  @RequirePermissions(Permission.ReportsViewFinancial)
  showtimeTicketMap(@CurrentActor() actor: RequestActor, @Param("showtimeId") showtimeId: string) {
    return this.reporting.showtimeTicketMap(this.location(actor), showtimeId);
  }

  @Get("distributors")
  @RequirePermissions(Permission.ReportsViewFinancial)
  distributors(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    const range = from || to ? this.range(from, to) : undefined;
    return this.reporting.distributorPerformance(this.location(actor), undefined, range);
  }

  @Get("distributors/performance.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async distributorsCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const range = from || to ? this.range(from, to) : undefined;
    const report = await this.reporting.distributorPerformance(this.location(actor), undefined, range);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-distributor-directory.csv"');
    response.send(this.reporting.distributorDirectoryCsv(report));
  }

  @Get("distributors/:name")
  @RequirePermissions(Permission.ReportsViewFinancial)
  distributor(@CurrentActor() actor: RequestActor, @Param("name") name: string, @Query("from") from?: string, @Query("to") to?: string) {
    const range = from || to ? this.range(from, to) : undefined;
    return this.reporting.distributorPerformance(this.location(actor), name, range);
  }

  @Get("distributors/:name/performance.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async distributorCsv(@CurrentActor() actor: RequestActor, @Param("name") name: string, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const range = from || to ? this.range(from, to) : undefined;
    const report = await this.reporting.distributorPerformance(this.location(actor), name, range);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-distributor-performance.csv"');
    response.send(this.reporting.distributorPerformanceCsv(report));
  }

  @Get("film-series/:seriesId")
  @RequirePermissions(Permission.ReportsViewFinancial)
  filmSeriesPerformance(
    @CurrentActor() actor: RequestActor,
    @Param("seriesId") seriesId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const range = from || to ? this.range(from, to) : undefined;
    return this.reporting.filmSeriesPerformance(this.location(actor), seriesId, range);
  }

  @Get("film-series/:seriesId/performance.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async filmSeriesPerformanceCsv(@CurrentActor() actor: RequestActor, @Param("seriesId") seriesId: string, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const range = from || to ? this.range(from, to) : undefined;
    const report = await this.reporting.filmSeriesPerformance(this.location(actor), seriesId, range);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-film-series-performance.csv"');
    response.send(this.reporting.filmSeriesPerformanceCsv(report));
  }

  @Get("audience-origins")
  @RequirePermissions(Permission.ReportsViewFinancial)
  audienceOrigins(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reporting.audienceOrigins(this.location(actor), this.range(from, to));
  }

  @Get("audience-analytics")
  audienceAnalytics(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reporting.audienceAnalytics(this.location(actor), this.range(from, to));
  }

  @Get("revenue.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async revenueCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const report = await this.reporting.revenue(this.location(actor), this.range(from, to));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-revenue.csv"');
    response.send(this.reporting.revenueCsv(report));
  }

  @Get("distributor-box-office.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async distributorBoxOfficeCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const report = await this.reporting.revenue(this.location(actor), this.range(from, to));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-distributor-box-office.csv"');
    response.send(this.reporting.distributorBoxOfficeCsv(report));
  }

  @Get("expenses")
  @RequirePermissions(Permission.ReportsViewFinancial)
  expenses(@CurrentActor() actor: RequestActor, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reporting.expenses(this.location(actor), this.range(from, to));
  }

  @Get("expenses.csv")
  @RequirePermissions(Permission.ReportsViewFinancial)
  async expensesCsv(@CurrentActor() actor: RequestActor, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() response: Response) {
    const report = await this.reporting.expenses(this.location(actor), this.range(from, to));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="attend-expenses.csv"');
    response.send(this.reporting.expensesCsv(report));
  }

  @Post("expenses")
  @RequirePermissions(Permission.ReportsViewFinancial)
  createExpense(@CurrentActor() actor: RequestActor, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(expenseSchema)) body: unknown) {
    return this.reporting.createExpense(this.location(actor), actor.sub, expenseSchema.parse(body), requestId);
  }

  @Delete("expenses/:expenseId")
  @RequirePermissions(Permission.ReportsViewFinancial)
  deleteExpense(@CurrentActor() actor: RequestActor, @Param("expenseId") expenseId: string, @Headers("idempotency-key") requestId: string | undefined) {
    return this.reporting.deleteExpense(this.location(actor), actor.sub, expenseId, requestId);
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

  @Get("customer-recency")
  customerRecency(@CurrentActor() actor: RequestActor, @Query("inactiveSince") inactiveSince?: string, @Query("limit") limit?: string) {
    const cutoff = inactiveSince ? new Date(inactiveSince) : new Date(NaN);
    const previewLimit = limit == null ? 25 : Number(limit);
    if (Number.isNaN(cutoff.getTime())) throw AppError.validationFailed("A valid inactiveSince date is required.");
    if (!Number.isInteger(previewLimit) || previewLimit < 1 || previewLimit > 100) throw AppError.validationFailed("Preview limit must be between 1 and 100.");
    return this.reporting.customerRecency(this.location(actor), cutoff, previewLimit);
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
