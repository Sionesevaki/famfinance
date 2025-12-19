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

it("creates a workspace and lists it for the user", async () => {
  const create = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Smith Family", currency: "EUR" })
    .expect(201);

  expect(create.body.workspaceId).toBeTruthy();

  const list = await request(app.getHttpServer())
    .get("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(Array.isArray(list.body)).toBe(true);
  expect(list.body.length).toBeGreaterThan(0);
  expect(list.body[0].workspaceId).toBe(create.body.workspaceId);
  expect(list.body[0].role).toBe("OWNER");
});

