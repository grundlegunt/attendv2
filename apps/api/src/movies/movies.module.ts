import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MoviesController } from "./movies.controller";
import { MoviesService } from "./movies.service";

@Module({
  imports: [AuditModule],
  controllers: [MoviesController],
  providers: [MoviesService],
})
export class MoviesModule {}
