import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { loadEnv } from "@cinema/config/env";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/http-exception.filter";
import { StructuredLogger } from "./common/logger.service";
import { isCorsOriginAllowed } from "./common/cors-origin";

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
  const configuredCorsOrigins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim());
  app.enableCors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, configuredCorsOrigins)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
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
