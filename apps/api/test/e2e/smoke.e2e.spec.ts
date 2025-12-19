import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../integration/setup/app";
import { startInfra } from "../integration/setup/testcontainers";
import { runMigrations } from "../integration/setup/run-migrations";

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

it("smoke: health + create workspace", async () => {
  await request(app.getHttpServer()).get("/health").expect(200);

  await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Family" })
    .expect(201);
});

