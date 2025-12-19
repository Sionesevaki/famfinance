import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";

function parseCorsOrigins(): string[] | null {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return null;
  const origins = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length ? origins : null;
}

export function configureApp(app: INestApplication) {
  const corsOrigins = parseCorsOrigins();
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    app.enableCors(true);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
}

