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

it("creates, edits, deletes transactions and supports merchants/categories listing", async () => {
  const createWs = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Smith Family", currency: "EUR" })
    .expect(201);

  const workspaceId = createWs.body.workspaceId as string;

  const category = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/categories`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Groceries" })
    .expect(201);

  const createTxn = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/transactions`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({
      occurredAt: "2025-12-17T00:00:00Z",
      amountCents: 1299,
      currency: "EUR",
      description: "Groceries",
      merchantName: "Albert Heijn",
      categoryName: "Groceries",
    })
    .expect(201);

  expect(createTxn.body.transactionId).toBeTruthy();
  expect(createTxn.body.source).toBe("MANUAL");
  expect(createTxn.body.merchant?.name).toBe("Albert Heijn");
  expect(createTxn.body.category?.name).toBe("Groceries");

  const merchants = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/merchants`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect((merchants.body as Array<{ name: string }>).some((m) => m.name === "Albert Heijn")).toBe(true);

  const categories = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/categories`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect((categories.body as Array<{ name: string }>).some((c) => c.name === "Groceries")).toBe(true);

  const listFiltered = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/transactions`)
    .query({
      categoryId: category.body.categoryId,
      merchantId: createTxn.body.merchant.merchantId,
      source: "MANUAL",
    })
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(listFiltered.body.length).toBe(1);
  expect(listFiltered.body[0].transactionId).toBe(createTxn.body.transactionId);

  const updated = await request(app.getHttpServer())
    .patch(`/workspaces/${workspaceId}/transactions/${createTxn.body.transactionId}`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ description: "Supermarket" })
    .expect(200);

  expect(updated.body.description).toBe("Supermarket");

  await request(app.getHttpServer())
    .delete(`/workspaces/${workspaceId}/transactions/${createTxn.body.transactionId}`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  const listAfterDelete = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/transactions`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .expect(200);

  expect(listAfterDelete.body.length).toBe(0);
});
