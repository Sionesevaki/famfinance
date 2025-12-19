1) Test folder blueprint (monorepo)
Folder layout
apps/
  api/
    src/
      modules/
        workspaces/
        invites/
        documents/
        transactions/
        analytics/
      common/
    test/
      unit/
        workspaces/
        invites/
        transactions/
      integration/
        setup/
          testcontainers.ts
          prisma.ts
          app.ts
        workspaces.int.spec.ts
        invites.int.spec.ts
        documents.int.spec.ts
        pipeline.int.spec.ts
        analytics.int.spec.ts
      e2e/
        smoke.e2e.spec.ts

  worker/
    src/
      processors/
    test/
      unit/
        fingerprint.spec.ts
        normalize.spec.ts
      integration/
        worker-pipeline.int.spec.ts
        dlq.int.spec.ts

packages/
  db/
    prisma/
      schema.prisma
      migrations/
    test/
      migrations.int.spec.ts

  contracts/
    src/
    test/
      contract.spec.ts

2) Shared test utilities (integration)
apps/api/test/integration/setup/testcontainers.ts

Starts Postgres + Redis + MinIO for integration tests.

import { GenericContainer, StartedTestContainer } from "testcontainers";

export type TestInfra = {
  pg: StartedTestContainer;
  redis: StartedTestContainer;
  minio: StartedTestContainer;
  env: Record<string, string>;
};

export async function startInfra(): Promise<TestInfra> {
  const pg = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "testdb",
    })
    .withExposedPorts(5432)
    .start();

  const redis = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .start();

  const minio = await new GenericContainer("minio/minio:latest")
    .withEnvironment({
      MINIO_ROOT_USER: "minio",
      MINIO_ROOT_PASSWORD: "minio123",
    })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .start();

  const dbUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/testdb`;

  return {
    pg,
    redis,
    minio,
    env: {
      DATABASE_URL: dbUrl,
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "minio123",
      S3_BUCKET: "test-bucket",
      // Auth test: use a local test JWT strategy (see below)
      KEYCLOAK_AUDIENCE: "api",
      KEYCLOAK_ISSUER: "http://test-issuer.local",
      KEYCLOAK_JWKS_URI: "http://test-jwks.local", // in tests we mock verification
    },
  };
}

apps/api/test/integration/setup/app.ts

Bootstraps Nest app for tests.

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";

export async function createTestApp(env: Record<string, string>) {
  Object.assign(process.env, env);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}

3) Auth in tests (recommended approach)

For tests, you don’t want to depend on a live Keycloak.

Best approach: Replace Keycloak guard with a TestAuthGuard in integration tests.

apps/api/test/integration/setup/test-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // Pretend we're authenticated
    req.user = {
      sub: req.headers["x-test-sub"] || "sub-user-1",
      email: req.headers["x-test-email"] || "user1@example.com",
      realm_access: { roles: (req.headers["x-test-roles"] || "").split(",").filter(Boolean) },
    };
    return true;
  }
}


Then in your AppModule (or a TestingModule override), override the global guard for tests.

4) Example tests per module
A) Workspaces — Unit test (business rules)

apps/api/test/unit/workspaces/workspace.service.spec.ts

import { describe, it, expect } from "vitest"; // or jest
// If using Jest, replace vitest imports with jest

describe("Workspace rules", () => {
  it("should not allow MEMBER to delete workspace", () => {
    const role = "MEMBER";
    const canDelete = role === "OWNER";
    expect(canDelete).toBe(false);
  });
});


(Replace with real service tests once implemented.)

B) Workspaces — Integration test (API + DB)

apps/api/test/integration/workspaces.int.spec.ts

import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { startInfra } from "./setup/testcontainers";
import { createTestApp } from "./setup/app";

let app: INestApplication;
let infra: Awaited<ReturnType<typeof startInfra>>;

beforeAll(async () => {
  infra = await startInfra();

  // run migrations here (see migrations test below)
  // await runMigrations(infra.env.DATABASE_URL);

  app = await createTestApp(infra.env);
});

afterAll(async () => {
  await app.close();
  await infra.pg.stop();
  await infra.redis.stop();
  await infra.minio.stop();
});

it("creates a workspace and assigns OWNER membership", async () => {
  const res = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .send({ name: "Smith Family", currency: "EUR" })
    .expect(201);

  expect(res.body.workspaceId).toBeTruthy();

  const list = await request(app.getHttpServer())
    .get("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .expect(200);

  expect(list.body.length).toBeGreaterThan(0);
});

C) Invites — Integration test (token lifecycle)

apps/api/test/integration/invites.int.spec.ts

import request from "supertest";

it("invite can be accepted once; cannot accept twice", async () => {
  // create workspace
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-owner")
    .send({ name: "Family", currency: "EUR" });

  const workspaceId = ws.body.workspaceId;

  // invite
  const inv = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites`)
    .set("x-test-sub", "sub-owner")
    .send({ email: "invitee@example.com", role: "MEMBER" })
    .expect(201);

  // normally token is emailed; in test you can expose it under a test-only flag
  const token = inv.body.tokenForTestOnly;
  expect(token).toBeTruthy();

  // accept
  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-invitee")
    .send({ token })
    .expect(200);

  // accept again -> fail
  await request(app.getHttpServer())
    .post("/invites/accept")
    .set("x-test-sub", "sub-invitee")
    .send({ token })
    .expect(400);
});


Tip: return tokenForTestOnly only when NODE_ENV === "test".

D) Documents — Integration test (MinIO upload + complete)

apps/api/test/integration/documents.int.spec.ts

import request from "supertest";
import axios from "axios";

it("presigns upload, uploads to MinIO, completes document", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .send({ name: "Family", currency: "EUR" });

  const workspaceId = ws.body.workspaceId;

  const presign = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/documents/upload-url`)
    .set("x-test-sub", "sub-user-1")
    .send({ filename: "test.pdf", mimeType: "application/pdf", sizeBytes: 10 })
    .expect(201);

  const { documentId, uploadUrl } = presign.body;

  // Upload a small payload
  await axios.put(uploadUrl, Buffer.from("hello pdf"), {
    headers: { "Content-Type": "application/pdf" },
  });

  await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/documents/${documentId}/complete`)
    .set("x-test-sub", "sub-user-1")
    .expect(200);
});

E) Pipeline E2E-lite (doc -> extraction -> transaction -> rollup)

apps/api/test/integration/pipeline.int.spec.ts

it("pipeline creates transaction and updates analytics rollup", async () => {
  // 1) upload doc
  // 2) create extraction (in test you can call worker processor directly or enqueue BullMQ job)
  // 3) normalize -> tx_upsert -> rollup
  // Assertions:
  // - transaction count > 0
  // - analytics summary total matches expected
});


This one becomes your most valuable “confidence test”.

F) Worker tests (idempotency + DLQ)

apps/worker/test/integration/dlq.int.spec.ts

it("failed job is retried then moved to DLQ", async () => {
  // Enqueue a job that always throws
  // Assert attempts count and fail record is created
});

5) Migration test (prevents production surprises)

packages/db/test/migrations.int.spec.ts

import { execSync } from "node:child_process";
import { startInfra } from "../../../apps/api/test/integration/setup/testcontainers";

it("migrations run on a fresh database", async () => {
  const infra = await startInfra();
  try {
    execSync(`DATABASE_URL="${infra.env.DATABASE_URL}" pnpm --filter @repo/db prisma migrate deploy`, {
      stdio: "inherit",
    });
  } finally {
    await infra.pg.stop();
    await infra.redis.stop();
    await infra.minio.stop();
  }
});


This guarantees:

every PR that changes schema has valid migrations

migrations work on a clean DB (most common failure in prod)