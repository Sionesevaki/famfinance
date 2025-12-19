import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient, WorkspaceRole } from "@famfinance/db";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";

let app: INestApplication;
let infra: Awaited<ReturnType<typeof startInfra>>;
let prisma: PrismaClient;

beforeAll(async () => {
  infra = await startInfra();
  runMigrations(infra.env.DATABASE_URL);
  prisma = new PrismaClient({ datasources: { db: { url: infra.env.DATABASE_URL } } });
  await prisma.$connect();
  app = await createTestApp(infra.env);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await infra.pg.stop();
  await infra.redis.stop();
  await infra.minio.stop();
}, 120_000);

it("members list is workspace-scoped and role-protected", async () => {
  await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-user2")
    .set("x-test-email", "user2@example.com")
    .expect(200);

  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const ownerUser = await prisma.user.findUnique({ where: { email: "owner@example.com" } });
  const user2 = await prisma.user.findUnique({ where: { email: "user2@example.com" } });
  expect(ownerUser).toBeTruthy();
  expect(user2).toBeTruthy();

  await prisma.workspaceMember.create({
    data: { workspaceId, userId: user2!.id, role: WorkspaceRole.MEMBER },
  });

  const ownerMembers = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/members`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  expect(Array.isArray(ownerMembers.body)).toBe(true);
  expect(ownerMembers.body.length).toBe(2);

  await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/members`)
    .set("x-test-sub", "sub-nonmember")
    .set("x-test-email", "nonmember@example.com")
    .expect(403);

  const ownerMemberRow = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: ownerUser!.id },
  });
  const user2MemberRow = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user2!.id },
  });
  expect(ownerMemberRow).toBeTruthy();
  expect(user2MemberRow).toBeTruthy();

  await request(app.getHttpServer())
    .patch(`/workspaces/${workspaceId}/members/${user2MemberRow!.id}`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ role: "ADMIN" })
    .expect(200);

  await request(app.getHttpServer())
    .delete(`/workspaces/${workspaceId}/members/${ownerMemberRow!.id}`)
    .set("x-test-sub", "sub-user2")
    .set("x-test-email", "user2@example.com")
    .expect(403);

  await request(app.getHttpServer())
    .delete(`/workspaces/${workspaceId}/members/${user2MemberRow!.id}`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  const after = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/members`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  expect(after.body.length).toBe(1);
});

