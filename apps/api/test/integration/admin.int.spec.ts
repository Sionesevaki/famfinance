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

it("blocks /admin/* for non-admins", async () => {
  await request(app.getHttpServer())
    .get("/admin/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(403);
});

it("allows platform_admin to list workspaces/users", async () => {
  const create = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Smith Family", currency: "EUR" })
    .expect(201);

  const workspaceId = create.body.workspaceId as string;

  const workspaces = await request(app.getHttpServer())
    .get("/admin/workspaces")
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  expect(Array.isArray(workspaces.body)).toBe(true);
  expect((workspaces.body as Array<{ workspaceId: string }>).some((w) => w.workspaceId === workspaceId)).toBe(true);

  const users = await request(app.getHttpServer())
    .get("/admin/users")
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  expect(Array.isArray(users.body)).toBe(true);
  expect((users.body as Array<{ email: string }>).some((u) => u.email === "user1@example.com")).toBe(true);

  await request(app.getHttpServer())
    .get("/admin/metrics")
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  const metrics = await request(app.getHttpServer())
    .get("/admin/metrics/prometheus")
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  expect(metrics.text).toContain("famfinance_users_total");
});
