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

it("presigns upload, uploads to MinIO, completes, and returns download URL", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const presign = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/documents/upload-url`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ filename: "test.txt", mimeType: "text/plain", sizeBytes: 11 })
    .expect(201);

  const { documentId, uploadUrl, uploadHeaders } = presign.body as {
    documentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };

  const payload = new TextEncoder().encode("hello world");
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: payload,
  });
  expect(uploadRes.status).toBeGreaterThanOrEqual(200);
  expect(uploadRes.status).toBeLessThan(300);

  await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/documents/${documentId}/complete`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200)
    .expect({ queued: true });

  const doc = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/documents/${documentId}`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(doc.body.documentId).toBe(documentId);
  expect(doc.body.extraction?.status).toBe("PENDING");

  const dl = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/documents/${documentId}/download-url`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(typeof dl.body.url).toBe("string");
  const downloaded = await fetch(dl.body.url);
  expect(downloaded.status).toBe(200);
  const text = await downloaded.text();
  expect(text).toBe("hello world");
});

