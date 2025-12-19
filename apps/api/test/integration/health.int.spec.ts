import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";

let app: INestApplication;
let infra: Awaited<ReturnType<typeof startInfra>>;

beforeAll(async () => {
  infra = await startInfra();
  runMigrations(infra.env.DATABASE_URL);
  app = await createTestApp(infra.env);
}, 120_000);

afterAll(async () => {
  await app.close();
  await infra.pg.stop();
  await infra.redis.stop();
  await infra.minio.stop();
}, 120_000);

it("GET /health returns ok", async () => {
  const res = await request(app.getHttpServer()).get("/health").expect(200).expect({ status: "ok" });
  expect(res.headers["x-request-id"]).toBeTruthy();
});
