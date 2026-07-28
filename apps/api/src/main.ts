import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { loadEnv } from "@cinema/config/env";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/http-exception.filter";
import { StructuredLogger } from "./common/logger.service";

async function bootstrap() {
  // Validate configuration before anything else boots. Fails fast and loud
  // per SECURITY.md §6 / AGENTS.md — never run in a degraded state because
  // a secret was missing.
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger("Bootstrap"),
    rawBody: true,
  });

  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix("api/v1");

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", message: `API listening on port ${env.PORT}`, env: env.NODE_ENV }));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "fatal", message: "Failed to start API", error: String(err) }));
  process.exit(1);
});
