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

it("invite can be accepted once; revoked invite cannot be accepted", async () => {
  await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-invitee")
    .set("x-test-email", "invitee@example.com")
    .expect(200);

  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const inv = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ email: "invitee@example.com", role: "MEMBER" })
    .expect(201);

  const token = inv.body.tokenForTestOnly as string;
  expect(token).toBeTruthy();

  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-invitee")
    .set("x-test-email", "invitee@example.com")
    .send({ token })
    .expect(200)
    .expect((res) => {
      expect(res.body.workspaceId).toBe(workspaceId);
      expect(res.body.membershipRole).toBe("MEMBER");
    });

  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-invitee")
    .set("x-test-email", "invitee@example.com")
    .send({ token })
    .expect(400);

  await request(app.getHttpServer())
    .get("/workspaces")
    .set("x-test-sub", "sub-invitee")
    .set("x-test-email", "invitee@example.com")
    .expect(200)
    .expect((res) => {
      expect(res.body.some((w: { workspaceId: string }) => w.workspaceId === workspaceId)).toBe(true);
    });

  const revoked = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ email: "revoked@example.com", role: "MEMBER" })
    .expect(201);

  await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites/${revoked.body.inviteId}/revoke`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-revoked")
    .set("x-test-email", "revoked@example.com")
    .send({ token: revoked.body.tokenForTestOnly })
    .expect(400);
});

it("rate limits /invites/accept", async () => {
  for (let i = 0; i < 3; i++) {
    await request(app.getHttpServer())
      .post("/invites/accept")
      .set("x-test-sub", "sub-rate")
      .set("x-test-email", "rate@example.com")
      .set("x-forwarded-for", "203.0.113.10")
      .send({ token: "definitely-invalid-token" })
      .expect(400);
  }

  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-rate")
    .set("x-test-email", "rate@example.com")
    .set("x-forwarded-for", "203.0.113.10")
    .send({ token: "definitely-invalid-token" })
    .expect(429);
});
