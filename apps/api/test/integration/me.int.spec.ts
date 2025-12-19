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

it("GET /me creates user row", async () => {
  const res = await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(res.body.id).toBeTruthy();
  expect(res.body.email).toBe("user1@example.com");
});

